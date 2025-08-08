const express = require("express");
const path = require("path");
const cors = require("cors");
const routes = require("./routes");
const util = require("util");
const fs = require("fs").promises;
const { exec } = require("child_process");
const { spawn } = require("child_process");

const app = express();
const port = 4000;

// 静的ファイルの提供
app.use(express.static("public"));
app.use(cors());
app.use(express.json());

// execPromiseの定義
const execPromise = util.promisify(exec);

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
    const { fromDate, toDate, teams, users } = req.body;

    // チームと個別ユーザーの情報をJSON形式でPythonスクリプトに渡す
    const filterParams = JSON.stringify({ teams, users });
    // JSONをダブルクォートで囲み、内部のダブルクォートをエスケープする
    const escapedParams = filterParams.replace(/"/g, '\\"');
    let command = `python fetch_pr_data.py "${fromDate}" "${toDate}" "${escapedParams}"`;

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

// ルートの設定（他のルートがある場合）
app.use(routes);

// サーバーの起動
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${port}`);
});
