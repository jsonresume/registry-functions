const functions = require("firebase-functions");
const _ = require("lodash");
const axios = require("axios");
const express = require("express");
const cors = require("cors");
const resumeSchema = require("resume-schema");
const fs = require("fs");
const app = express();
// Import Admin SDK
var admin = require("firebase-admin");

if (process.env.NODE_ENV === "production") {
  admin.initializeApp(functions.config().firebase);
} else {
  var serviceAccount = require("../creds.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://jsonresume-registry.firebaseio.com"
  });
}

var db = admin.database();
app.use(cors({ origin: true }));

const makeTemplate = message => {
  const template = fs.readFileSync(__dirname + "/template.html", "utf8");
  return template.replace("{MESSAGE}", message);
};

app.get("/:username", async (req, res) => {
  const username = req.params.username;
  if (
    [
      "favicon.ico",
      "competition",
      "stats",
      "apple-touch-icon.png",
      "apple-touch-icon-precomposed.png",
      "robots.txt"
    ].indexOf(username) !== -1
  ) {
    return res.send(null);
  }
  var ref = db.ref();
  var usersRef = ref.child("gists/" + username);
  usersRef.on("value", async dataSnapshot => {
    console.log("=======");
    console.log(dataSnapshot.val());
    let gistId;
    if (!dataSnapshot.val() || !dataSnapshot.val().gistId) {
      console.log("Fetching gistId");
      console.log(`https://api.github.com/users/${req.params.username}/gists`);
      let gistData = {};
      try {
        gistData = await axios.get(
          `https://api.github.com/users/${req.params.username}/gists`
        );
      } catch (e) {
        return res.send(makeTemplate("This is not a valid Github username"));
      }
      if (!gistData.data) {
        return res.send(makeTemplate("This is not a valid Github username"));
      }
      const resumeUrl = _.find(gistData.data, f => {
        return f.files["resume.json"];
      });
      if (!resumeUrl) {
        return res.send(makeTemplate("You have no gists named resume.json"));
      }
      gistId = resumeUrl.id;
    } else {
      console.log("Using cached gistId");
      gistId = dataSnapshot.val().gistId;
    }

    usersRef.set({ gistId: gistId }, () => {});
    const fullResumeGistUrl =
      `https://gist.githubusercontent.com/${username}/${gistId}/raw?cachebust=` +
      new Date().getTime();
    console.log(fullResumeGistUrl);
    let resumeRes = {};
    try {
      resumeRes = await axios({
        method: "GET",
        headers: { "content-type": "application/json" },
        url: fullResumeGistUrl
      });
    } catch (e) {
      // If gist url is invalid, flush the gistid in cache
      usersRef.set(null, () => {});
      return res.send(
        makeTemplate("The gist couldnt load, we flushed the cache so try again")
      );
    }

    if (!resumeRes.data) {
      return res.send(makeTemplate("Something went wrong fetching resume"));
    }
    resumeSchema.validate(resumeRes.data, async (err, report) => {
      console.log("validation finished");
      if (err) {
        console.log(err);
        return res.send(
          makeTemplate("Resume json invalid - " + JSON.stringify(err))
        );
      }
      const theme =
        req.query.theme ||
        (resumeRes.data.meta && resumeRes.data.meta.theme) ||
        "flat";
      const resumeHTMLRes = await axios.post(
        `https://themes.jsonresume.org/theme/${theme}`,
        { resume: resumeRes.data }
      );
      if (!resumeHTMLRes.data) {
        res.send("There was an error generatoring your resume");
      }
      res.send(resumeHTMLRes.data);
    });
  });
});
app.listen(3000);
exports.registry = functions.https.onRequest(app);
