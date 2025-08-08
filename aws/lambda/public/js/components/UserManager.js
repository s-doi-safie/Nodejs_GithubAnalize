/**
 * ユーザー管理とオートコンプリート機能を担当するクラス
 */
class UserManager {
    constructor(apiService) {
        this.apiService = apiService;
        this.userAutocomplete = null;
        this.allUsers = new Set();
        this.initAutocomplete();
    }

    /**
     * オートコンプリートを初期化
     */
    initAutocomplete() {
        this.userAutocomplete = new AutocompleteInput('usersAutocomplete', {
            placeholder: 'user1, user2, user3...',
            separator: ',',
            noResultsText: 'No users found',
            maxSuggestions: 8,
            minChars: 1,
            caseSensitive: false,
            allowDuplicates: false
        });
    }

    /**
     * チームデータからユーザーリストを取得・更新
     * @param {Object} teams - チームデータ
     */
    updateUsersFromTeams(teams) {
        if (!teams) return;

        // チームからユーザー名を抽出
        for (const [teamName, members] of Object.entries(teams)) {
            if (Array.isArray(members)) {
                members.forEach(user => {
                    if (typeof user === 'string' && user.trim()) {
                        this.allUsers.add(user.trim());
                    }
                });
            }
        }

        this.updateSuggestions();
    }

    /**
     * PRデータからユーザーリストを更新
     * @param {Object} data - PRデータ
     */
    async updateUsersFromPRData(data) {
        if (!data || !data.pr_details) return;

        try {
            // PRデータから作成者、レビュー要求者、完了者を抽出
            data.pr_details.forEach(pr => {
                // 作成者
                if (pr.author && typeof pr.author === 'string') {
                    this.allUsers.add(pr.author.trim());
                }

                // レビュー要求者
                if (Array.isArray(pr.requested)) {
                    pr.requested.forEach(user => {
                        if (typeof user === 'string' && user.trim()) {
                            this.allUsers.add(user.trim());
                        }
                    });
                }

                // 完了者
                if (Array.isArray(pr.completed)) {
                    pr.completed.forEach(user => {
                        if (typeof user === 'string' && user.trim()) {
                            this.allUsers.add(user.trim());
                        }
                    });
                }
            });

            this.updateSuggestions();
        } catch (error) {
            console.error('Error updating users from PR data:', error);
        }
    }

    /**
     * オートコンプリートの提案リストを更新
     */
    updateSuggestions() {
        if (this.userAutocomplete) {
            const sortedUsers = Array.from(this.allUsers).sort((a, b) => 
                a.toLowerCase().localeCompare(b.toLowerCase())
            );
            this.userAutocomplete.setSuggestions(sortedUsers);
        }
    }

    /**
     * 選択されたユーザーを取得
     * @returns {Array<string>} 選択されたユーザー名の配列
     */
    getSelectedUsers() {
        if (!this.userAutocomplete) {
            return [];
        }
        return this.userAutocomplete.getValues();
    }

    /**
     * 選択されたユーザーを設定
     * @param {Array<string>|string} users - 設定するユーザー名
     */
    setSelectedUsers(users) {
        if (this.userAutocomplete) {
            this.userAutocomplete.setValues(users);
        }
    }

    /**
     * ユーザー選択をクリア
     */
    clearSelectedUsers() {
        if (this.userAutocomplete) {
            this.userAutocomplete.clear();
        }
    }

    /**
     * 既知のユーザー名を手動で追加
     * @param {string|Array<string>} users - 追加するユーザー名
     */
    addKnownUsers(users) {
        if (typeof users === 'string') {
            users = [users];
        }

        if (Array.isArray(users)) {
            users.forEach(user => {
                if (typeof user === 'string' && user.trim()) {
                    this.allUsers.add(user.trim());
                }
            });
            this.updateSuggestions();
        }
    }

    /**
     * 特定のユーザー名パターンを除外
     * @param {Array<string>} patterns - 除外するパターン
     */
    excludeUserPatterns(patterns) {
        if (!Array.isArray(patterns)) return;

        const filteredUsers = Array.from(this.allUsers).filter(user => {
            return !patterns.some(pattern => {
                if (typeof pattern === 'string') {
                    return user.includes(pattern);
                }
                if (pattern instanceof RegExp) {
                    return pattern.test(user);
                }
                return false;
            });
        });

        this.allUsers = new Set(filteredUsers);
        this.updateSuggestions();
    }

    /**
     * オートコンプリートに変更リスナーを追加
     * @param {Function} callback - 変更時のコールバック
     */
    onSelectionChange(callback) {
        if (this.userAutocomplete) {
            const container = document.getElementById('usersAutocomplete');
            if (container) {
                container.addEventListener('change', callback);
            }
        }
    }

    /**
     * オートコンプリートを無効化
     */
    disable() {
        if (this.userAutocomplete) {
            this.userAutocomplete.disable();
        }
    }

    /**
     * オートコンプリートを有効化
     */
    enable() {
        if (this.userAutocomplete) {
            this.userAutocomplete.enable();
        }
    }

    /**
     * フォーカス
     */
    focus() {
        if (this.userAutocomplete) {
            this.userAutocomplete.focus();
        }
    }

    /**
     * すべての既知ユーザーを取得
     * @returns {Array<string>} すべてのユーザー名の配列
     */
    getAllKnownUsers() {
        return Array.from(this.allUsers).sort((a, b) => 
            a.toLowerCase().localeCompare(b.toLowerCase())
        );
    }

    /**
     * ユーザー数を取得
     * @returns {number} 既知ユーザーの数
     */
    getUserCount() {
        return this.allUsers.size;
    }
}