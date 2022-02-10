const functions = require("firebase-functions");
const _ = require("lodash");
const axios = require("axios");
const express = require("express");
const cors = require("cors");
const resumeSchema = require("resume-schema");
const fs = require("fs");
const qr = require("qr-image");
const app = express();
app.use(cors({ origin: true }));
// Import Admin SDK
var admin = require("firebase-admin");

const packages = JSON.parse(fs.readFileSync(__dirname + "/package.json"))
  .dependencies;

const themes = _.filter(_.keys(packages), (p) => {
  return p.indexOf("theme") !== -1;
});

admin.initializeApp(functions.config().firebase);

var db = admin.database();
const dbs = admin.firestore();

const makeTemplate = (message) => {
  const template = fs.readFileSync(__dirname + "/template.html", "utf8");
  return template.replace("{MESSAGE}", message);
};
const getTheme = (theme) => {
  try {
    return require(__dirname + "/node_modules/jsonresume-theme-" + theme);
  } catch (e) {
    return {
      e: e.toString(),
      error:
        "Theme is not supported please visit -> https://github.com/jsonresume/registry-functions/issues/7",
    };
  }
};

app.get("/themes", (req, res) => {
  res.send(themes);
});
app.get("/theme/:theme", (req, res) => {
  const resumeJson = JSON.parse(fs.readFileSync(__dirname + "/resume.json"));
  const theme = req.params.theme.toLowerCase();
  const themeRenderer = getTheme(theme);
  if (themeRenderer.error) {
    return res.send(themeRenderer.error + " - " + themeRenderer.e);
  }
  const resumeHTML = themeRenderer.render(resumeJson, {});
  res.send(resumeHTML);
});
app.get("/", (req, res) => {
  res.send("Visit jsonresume.org to learn more");
});
app.get("/all", (req, res) => {
  const resumesRef = dbs.collection("resumes");
  resumesRef
    .get()
    .then((snapshot) => {
      const resumes = [];
      snapshot.forEach((doc) => {
        resumes.push(doc.id);
        console.log(doc.id, "=>", doc.data());
      });
      return res.send(resumes);
    })
    .catch((err) => {
      console.log("Error getting documents", err);
      return [];
    });
});
app.post("/theme/:theme", (req, res) => {
  console.log("Rendering theme");
  const resumeJson = req.body.resume;
  var start = new Date();
  const theme = req.params.theme.toLowerCase();
  const themeRenderer = getTheme(theme);
  var end = new Date() - start;
  console.info("Execution time getTheme: %dms", end);
  if (themeRenderer.error) {
    return res.send(themeRenderer.error + " - " + themeRenderer.e);
  }
  start = new Date();
  const resumeHTML = themeRenderer.render(resumeJson, {});
  end = new Date() - start;
  console.info("Execution time render: %dms", end);
  console.log("finished");
  res.send(resumeHTML);
});

// THIS IS A WIP TO SUPPORT PUTTING A resume.json in a `resume` repo
app.get("/repo/:username", async (req, res) => {
  const username = req.params.username;
  if (
    [
      "favicon.ico",
      "competition",
      "stats",
      "apple-touch-icon.png",
      "apple-touch-icon-precomposed.png",
      "robots.txt",
    ].indexOf(username) !== -1
  ) {
    return res.send(null);
  }

  try {
    resumeRes = await axios({
      method: "GET",
      headers: { "content-type": "application/json" },
      url: `https://raw.githubusercontent.com/${username}/resume/master/resume.json`,
    });
  } catch (e) {
    return res.send(
      makeTemplate(
        "An error occurred, please check that https://github.com/${username}/resume/raw/master/resume.json loads for you. (Your repo name must be 'resume')"
      )
    );
  }
  if (!resumeRes.data) {
    return res.send(
      makeTemplate(
        "An error occurred, please check that https://github.com/${username}/resume/raw/master/resume.json loads for you. (Your repo name must be 'resume')"
      )
    );
  }
  resumeSchema.validate(resumeRes.data, async (err, report) => {
    console.log("validation finished");
    if (err) {
      console.log(err);
      return res.send(
        makeTemplate(
          "Resume json invalid - " +
            JSON.stringify(err) +
            " - Please visit https://github.com/jsonresume/registry-functions/issues/27"
        )
      );
    }
    const resumesRef = dbs.collection("resumes");
    resumesRef.doc(username).set(resumeRes.data);
    let theme =
      req.query.theme ||
      (resumeRes.data.meta && resumeRes.data.meta.theme) ||
      "actual";
    theme = theme.toLowerCase();
    const themeRenderer = getTheme(theme);
    if (themeRenderer.error) {
      return res.send(themeRenderer.error + " - " + themeRenderer.e);
    }
    const resumeHTML = themeRenderer.render(resumeRes.data, {});
    res.send(resumeHTML);
  });
});

app.get("/:username.:ext", async (req, res) => {
  const username = req.params.username.split('.')[0]
  const parsedFormat = req.params.ext.split('.');
  console.log('parsed', req.params.ext, parsedFormat);
  console.log('shit', req.params.ext, parsedFormat);
  if (parsedFormat[0] === 'png') {
  var code = qr.image('https://registry.jsonresume.org/' + username, { type: 'png', ec_level: 'M', size: 60, margin: 1, parse_url: true });
    res.setHeader('Content-type', 'image/png');
    code.pipe(res);
  } else {
    res.send('Must be in the format of registry.jsonresume.org/thomasdavis.qr.png')
  }
});

app.get("/:username", async (req, res) => {
  const username = req.params.username;
  if (
    [
      "favicon.ico",
      "competition",
      "stats",
      "apple-touch-icon.png",
      "apple-touch-icon-precomposed.png",
      "robots.txt",
    ].indexOf(username) !== -1
  ) {
    return res.send(null);
  }

  var ref = db.ref();
  var usersRef = ref.child("gists/" + username);
  usersRef.on("value", async (dataSnapshot) => {
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
      const resumeUrl = _.find(gistData.data, (f) => {
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
        url: fullResumeGistUrl,
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
          makeTemplate(
            "Resume json invalid - " +
              JSON.stringify(err) +
              " - Please visit https://github.com/jsonresume/registry-functions/issues/27"
          )
        );
      }
      const resumesRef = dbs.collection("resumes");
      resumesRef.doc(username).set(resumeRes.data);
      let theme =
        req.query.theme ||
        (resumeRes.data.meta && resumeRes.data.meta.theme) ||
        "flat";
      theme = theme.toLowerCase();
      const themeRenderer = getTheme(theme);
      if (themeRenderer.error) {
        return res.send(themeRenderer.error + " - " + themeRenderer.e);
      }
      const resumeHTML = themeRenderer.render(resumeRes.data, {});
      // if (!resumeHTMLRes.data) {
      //   res.send("There was an error generatoring your resume");
      // }
      res.send(resumeHTML);
    });
  });
});




app.listen(3000);
exports.registry = functions.https.onRequest(app);
