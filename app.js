const express = require("express");
const path = require("path");
const cors = require("cors");
const util = require("util");
const fs = require("fs").promises;
const { exec } = require("child_process");
const { spawn } = require("child_process");

const app = express();
const port = 4001;
// exec関数をPromiseベースの関数に変換
const execPromise = util.promisify(exec);

// 静的ファイルの提供
app.use(express.static("public"));
app.use(cors());
app.use(express.json());

// チーム情報を提供するエンドポイント
app.get("/api/teams", cors(), async (req, res) => {
  try {
    const data = await fs.readFile("teams.json", "utf8");
    const teams = JSON.parse(data);
    res.json({ teams });
  } catch (err) {
    console.error("Error getting teams:", err);
    res.status(500).json({ error: "Error getting teams" });
  }
});

// チーム情報を更新するエンドポイント
app.post("/update-teams", async (req, res) => {
  try {
    console.log("チーム情報を更新中...");

    // get_team.pyを実行してチーム情報を更新
    const { stdout, stderr } = await execPromise("python get_team.py");

    // Pythonコードのログメッセージを出力
    if (stderr) {
      console.log("Python logs:", stderr);
    }

    console.log("チーム情報の更新が完了しました");
    return res.json({
      message: "チーム情報が正常に更新されました",
      data: stdout,
    });
  } catch (error) {
    console.error(`Error: ${error}`);
    return res.status(500).json({ error: "チーム情報の更新に失敗しました" });
  }
});

// PythonでGithubのデータを更新するエンドポイント
app.post("/run-python", async (req, res) => {
  try {
    console.log("Fetching data from Github...");
    const { fromDate, toDate, team } = req.body;
    let command = `python fetch_pr_data.py "${fromDate}" "${toDate}"`;

    // チームが指定されている場合は、コマンドにチームパラメータを追加
    if (team && team !== "all") {
      command += ` "${team}"`;
    }

    const { stdout, stderr } = await execPromise(command);
    // Pythonコードのログメッセージを出力
    if (stderr) {
      console.log("Python logs:", stderr);
    }
    console.log("Success Fetching data from Github");
    return res.json({ message: "Successfully data updated", data: stdout });
  } catch (error) {
    console.error(`Error: ${error}`);
    return res.status(500).json({ error: "Failed to fetch or parse data" });
  }
});

// Githubのデータを返すエンドポイント
app.get("/api/review-data", cors(), async (req, res) => {
  try {
    const data = await fs.readFile("github_data.json", "utf8");
    const result = JSON.parse(data);
    res.json(result);
  } catch (err) {
    console.error("Error reading file:", err);
    res.status(500).json({ error: "Error reading data" });
  }
});

// サーバーの起動
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
