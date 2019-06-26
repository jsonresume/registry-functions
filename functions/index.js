const functions = require("firebase-functions");
const _ = require("lodash");
const axios = require("axios");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const app = express();

app.use(cors({ origin: true }));

app.get("/:username", async (req, res) => {
  const username = req.params.username;
  if (username === "favicon.ico") {
    return res.send(null);
  }
  console.log(`https://api.github.com/users/${req.params.username}/gists`);
  const gistData = await axios.get(
    `https://api.github.com/users/${req.params.username}/gists`
  );
  if (!gistData.data) {
    res.send("This username does not exist on Github");
  }
  const resumeUrl = _.find(gistData.data, f => {
    return f.files["resume.json"];
  });
  if (!resumeUrl) {
    res.send("You have no gists named resume.json");
  }
  const gistId = resumeUrl.id;
  const options =
    resumeUrl.description.length > 0 ? JSON.parse(resumeUrl.description) : {};
  const theme = options.theme || "flat";
  const fullResumeGistUrl = `https://gist.githubusercontent.com/${username}/${gistId}/raw/`;
  console.log(fullResumeGistUrl);
  const resumeRes = await axios({
    method: "GET",
    headers: { "content-type": "application/json" },
    url: fullResumeGistUrl
  });
  if (!resumeRes.data) {
    res.send("Something went wrong fetching resume");
  }
  console.log(resumeRes);
  const resumeHTMLRes = await axios.post(
    `https://themes.jsonresume.org/theme/${theme}`,
    { resume: resumeRes.data }
  );
  if (!resumeHTMLRes.data) {
    res.send("There was an error generatoring your resume");
  }
  res.send(resumeHTMLRes.data);
});
app.listen(3000);
exports.registry = functions.https.onRequest(app);
