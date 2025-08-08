/**
 * チーム管理を担当するクラス
 */
class TeamManager {
    constructor(apiService, notificationManager) {
        this.apiService = apiService;
        this.notificationManager = notificationManager;
        this.teams = {};
    }

    /**
     * チーム情報を読み込み
     */
    async loadTeams() {
        try {
            const data = await this.apiService.getTeams();
            this.teams = data.teams;
            this.renderTeamCheckboxes();
            return this.teams;
        } catch (error) {
            console.error("Error loading teams:", error);
            this.notificationManager.showError("チーム情報の読み込みに失敗しました");
        }
    }

    /**
     * チーム情報を更新
     */
    async updateTeamInfo() {
        this.notificationManager.showLoading("チーム情報を更新中...");

        try {
            const data = await this.apiService.updateTeams();
            
            if (data.error) {
                throw new Error(data.error);
            }

            // チーム情報を再読み込み
            await this.loadTeams();
            
            this.notificationManager.showSuccess("チーム情報が正常に更新されました");
        } catch (error) {
            console.error("Error:", error);
            this.notificationManager.showError("チーム情報の更新に失敗しました");
        } finally {
            this.notificationManager.hideLoading();
        }
    }

    /**
     * チームのチェックボックスを描画
     */
    renderTeamCheckboxes() {
        const teamCheckboxes = document.getElementById("teamCheckboxes");
        if (!teamCheckboxes) return;

        // 既存のチェックボックスをクリア（「すべてのチーム」オプションは残す）
        const allTeamsCheckbox = document.getElementById("team-all");
        const allTeamsDiv = allTeamsCheckbox?.parentElement;
        teamCheckboxes.innerHTML = "";
        
        if (allTeamsDiv) {
            teamCheckboxes.appendChild(allTeamsDiv);
        }

        // 各チームのチェックボックスを追加
        for (const teamName in this.teams) {
            const teamDiv = document.createElement("div");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.id = `team-${teamName}`;
            checkbox.value = teamName;
            checkbox.classList.add("team-checkbox");
            
            const label = document.createElement("label");
            label.htmlFor = `team-${teamName}`;
            label.textContent = teamName;
            
            teamDiv.appendChild(checkbox);
            teamDiv.appendChild(label);
            teamCheckboxes.appendChild(teamDiv);
        }

        this.setupCheckboxEventListeners();
    }

    /**
     * チェックボックスのイベントリスナーを設定
     */
    setupCheckboxEventListeners() {
        // 「すべてのチーム」チェックボックスのイベントリスナー
        const allTeamsCheckbox = document.getElementById("team-all");
        if (allTeamsCheckbox) {
            allTeamsCheckbox.addEventListener("change", (e) => {
                if (e.target.checked) {
                    document.querySelectorAll(".team-checkbox").forEach((cb) => {
                        cb.checked = false;
                    });
                }
            });
        }

        // 個別チームのチェックボックスのイベントリスナー
        document.querySelectorAll(".team-checkbox").forEach((checkbox) => {
            checkbox.addEventListener("change", (e) => {
                if (e.target.checked && allTeamsCheckbox) {
                    allTeamsCheckbox.checked = false;
                }
            });
        });
    }

    /**
     * 選択されたチームとユーザーを取得
     * @returns {Object} 選択されたチームとユーザー
     */
    getSelectedTeamsAndUsers() {
        // 選択されたチームを取得
        const selectedTeams = [];
        const allTeamsCheckbox = document.getElementById("team-all");
        const allTeamsSelected = allTeamsCheckbox ? allTeamsCheckbox.checked : true;

        if (!allTeamsSelected) {
            document.querySelectorAll(".team-checkbox:checked").forEach((cb) => {
                selectedTeams.push(cb.value);
            });
        }

        // 入力されたユーザーを取得
        const usersInput = document.getElementById("usersInput");
        const usersValue = usersInput ? usersInput.value : "";
        const users = usersValue
            ? usersValue
                .split(",")
                .map((u) => u.trim())
                .filter((u) => u)
            : [];

        return { teams: selectedTeams, users };
    }
}