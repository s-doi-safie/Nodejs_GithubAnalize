/**
 * データ処理サービス
 * PR分析データの処理・整形・集計を担当
 */
class DataProcessor {
    constructor() {
        // ボットやシステムアカウントを除外するパターン
        this.botPatterns = [
            'bot',
            '[bot]',
            'dependabot',
            'github-actions',
            'renovate',
            'greenkeeper',
            'codecov',
            'snyk'
        ];
    }

    /**
     * ボットアカウントを除外
     */
    filterBotAccounts(data) {
        const filtered = {};
        
        for (const [username, userData] of Object.entries(data)) {
            if (!this.isBotAccount(username)) {
                filtered[username] = userData;
            }
        }
        
        return filtered;
    }

    /**
     * ボットアカウントかどうかを判定
     */
    isBotAccount(username) {
        const lowerUsername = username.toLowerCase();
        return this.botPatterns.some(pattern => 
            lowerUsername.includes(pattern.toLowerCase())
        );
    }

    /**
     * 非メンバーを除外（チーム情報がある場合）
     */
    filterNonMembers(prData, teamData = null) {
        if (!teamData) {
            // チーム情報がない場合はボットのみ除外
            return {
                ...prData,
                data: this.filterBotAccounts(prData.data || {})
            };
        }

        const memberUsernames = new Set();
        
        // チーム情報から全メンバーを抽出
        for (const team of Object.values(teamData)) {
            if (team.members) {
                team.members.forEach(member => {
                    memberUsernames.add(member.login);
                });
            }
        }

        // メンバーかつボットでないユーザーのみ抽出
        const filteredData = {};
        for (const [username, userData] of Object.entries(prData.data || {})) {
            if (memberUsernames.has(username) && !this.isBotAccount(username)) {
                filteredData[username] = userData;
            }
        }

        return {
            ...prData,
            data: filteredData
        };
    }

    /**
     * データセット設定（チャート表示用）
     */
    configureDatasets(prData) {
        const data = prData.data || {};
        
        const datasets = {
            labels: [],
            created: [],
            reviewed: [],
            users: []
        };

        // ユーザー別のデータを集計
        for (const [username, userData] of Object.entries(data)) {
            datasets.labels.push(username);
            datasets.created.push(userData.created_count || 0);
            datasets.reviewed.push(userData.reviewed_count || 0);
            datasets.users.push({
                username: username,
                avatar_url: userData.avatar_url,
                created_count: userData.created_count || 0,
                reviewed_count: userData.reviewed_count || 0
            });
        }

        return datasets;
    }

    /**
     * 特定ユーザーのPRをフィルタリング
     */
    filterPRsByPerson(prDetails, person) {
        const authorPrs = [];
        const requestedPrs = [];
        const completedPrs = [];

        for (const pr of prDetails) {
            // 作成者のPR
            if (pr.author === person) {
                authorPrs.push(pr);
            }

            // レビューがリクエストされたPR
            if (pr.requested_reviewers && pr.requested_reviewers.includes(person)) {
                if (pr.status === 'merged' || pr.status === 'closed') {
                    completedPrs.push(pr);
                } else {
                    requestedPrs.push(pr);
                }
            }

            // アサインされたPR
            if (pr.assignees && pr.assignees.includes(person)) {
                if (pr.status === 'merged' || pr.status === 'closed') {
                    completedPrs.push(pr);
                } else {
                    requestedPrs.push(pr);
                }
            }
        }

        return {
            authorPrs: this.sortPRsByDate(authorPrs),
            requestedPrs: this.sortPRsByDate(requestedPrs),
            completedPrs: this.sortPRsByDate(completedPrs)
        };
    }

    /**
     * PRを日付でソート
     */
    sortPRsByDate(prs) {
        return prs.sort((a, b) => {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            return dateB - dateA; // 新しい順
        });
    }

    /**
     * PR統計情報を計算
     */
    calculatePRStatistics(prDetails) {
        const stats = {
            total_prs: prDetails.length,
            open_prs: 0,
            closed_prs: 0,
            merged_prs: 0,
            avg_lifetime_days: 0,
            avg_comments: 0,
            reviews_per_pr: 0,
            authors: new Set(),
            repositories: new Set()
        };

        let totalLifetime = 0;
        let totalComments = 0;
        let totalReviews = 0;

        for (const pr of prDetails) {
            // ステータス別カウント
            if (pr.status === 'open') {
                stats.open_prs++;
            } else if (pr.status === 'merged') {
                stats.merged_prs++;
            } else {
                stats.closed_prs++;
            }

            // 作成者とリポジトリを記録
            stats.authors.add(pr.author);
            stats.repositories.add(pr.repository);

            // 数値統計
            totalLifetime += pr.lifetime_days || 0;
            totalComments += pr.num_comments || 0;
            
            // レビュー数をカウント（PR詳細から推定）
            if (pr.first_review) {
                totalReviews++;
            }
        }

        // 平均値を計算
        if (prDetails.length > 0) {
            stats.avg_lifetime_days = Math.round(totalLifetime / prDetails.length * 10) / 10;
            stats.avg_comments = Math.round(totalComments / prDetails.length * 10) / 10;
            stats.reviews_per_pr = Math.round(totalReviews / prDetails.length * 100) / 100;
        }

        // Setをサイズに変換
        stats.unique_authors = stats.authors.size;
        stats.unique_repositories = stats.repositories.size;
        stats.authors = Array.from(stats.authors);
        stats.repositories = Array.from(stats.repositories);

        return stats;
    }

    /**
     * 期間別データ分析
     */
    analyzePeriodData(prDetails, days = 7) {
        const periods = [];
        const now = new Date();
        const periodCount = Math.ceil(30 / days); // 過去30日を指定期間で分割

        // 期間を作成
        for (let i = 0; i < periodCount; i++) {
            const endDate = new Date(now.getTime() - (i * days * 24 * 60 * 60 * 1000));
            const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));
            
            periods.unshift({
                start: startDate,
                end: endDate,
                label: `${startDate.toISOString().split('T')[0]} - ${endDate.toISOString().split('T')[0]}`,
                created: 0,
                closed: 0,
                merged: 0
            });
        }

        // PRを期間別に分類
        for (const pr of prDetails) {
            const createdDate = new Date(pr.created_at);
            const closedDate = pr.closed_at ? new Date(pr.closed_at) : null;
            const mergedDate = pr.merged_at ? new Date(pr.merged_at) : null;

            for (const period of periods) {
                // 作成数
                if (createdDate >= period.start && createdDate < period.end) {
                    period.created++;
                }

                // クローズ数
                if (closedDate && closedDate >= period.start && closedDate < period.end) {
                    period.closed++;
                }

                // マージ数
                if (mergedDate && mergedDate >= period.start && mergedDate < period.end) {
                    period.merged++;
                }
            }
        }

        return periods;
    }

    /**
     * レビュー効率性分析
     */
    analyzeReviewEfficiency(prDetails) {
        const analysis = {
            fast_reviews: 0,      // 1日以内
            medium_reviews: 0,    // 1-3日
            slow_reviews: 0,      // 3日以上
            no_reviews: 0,        // レビューなし
            avg_review_time_hours: 0
        };

        let totalReviewTime = 0;
        let reviewedCount = 0;

        for (const pr of prDetails) {
            if (!pr.first_review) {
                analysis.no_reviews++;
                continue;
            }

            const createdTime = new Date(pr.created_at);
            const firstReviewTime = new Date(pr.first_review);
            const reviewTimeHours = (firstReviewTime - createdTime) / (1000 * 60 * 60);

            totalReviewTime += reviewTimeHours;
            reviewedCount++;

            if (reviewTimeHours <= 24) {
                analysis.fast_reviews++;
            } else if (reviewTimeHours <= 72) {
                analysis.medium_reviews++;
            } else {
                analysis.slow_reviews++;
            }
        }

        if (reviewedCount > 0) {
            analysis.avg_review_time_hours = Math.round(totalReviewTime / reviewedCount * 10) / 10;
        }

        return analysis;
    }

    /**
     * チーム貢献度分析
     */
    analyzeTeamContributions(prData, teamData) {
        if (!teamData) {
            return null;
        }

        const teamStats = {};

        // 各チームの統計を初期化
        for (const [teamName, teamInfo] of Object.entries(teamData)) {
            teamStats[teamName] = {
                name: teamName,
                member_count: teamInfo.members ? teamInfo.members.length : 0,
                created_prs: 0,
                reviewed_prs: 0,
                members: []
            };

            // メンバー別統計
            if (teamInfo.members) {
                for (const member of teamInfo.members) {
                    const userData = prData.data[member.login];
                    if (userData) {
                        teamStats[teamName].created_prs += userData.created_count || 0;
                        teamStats[teamName].reviewed_prs += userData.reviewed_count || 0;
                        
                        teamStats[teamName].members.push({
                            username: member.login,
                            name: member.name,
                            created: userData.created_count || 0,
                            reviewed: userData.reviewed_count || 0
                        });
                    }
                }
            }
        }

        return teamStats;
    }

    /**
     * データの検証と修正
     */
    validateAndFixData(prData) {
        const fixed = {
            data: {},
            pr_details: [],
            period: prData.period || [],
            teams: prData.teams || [],
            users: prData.users || []
        };

        // データオブジェクトの検証
        if (prData.data && typeof prData.data === 'object') {
            for (const [username, userData] of Object.entries(prData.data)) {
                if (userData && typeof userData === 'object') {
                    fixed.data[username] = {
                        created_count: Math.max(0, parseInt(userData.created_count) || 0),
                        reviewed_count: Math.max(0, parseInt(userData.reviewed_count) || 0),
                        avatar_url: userData.avatar_url || '',
                        created_prs: userData.created_prs || [],
                        reviewed_prs: userData.reviewed_prs || []
                    };
                }
            }
        }

        // PR詳細の検証
        if (Array.isArray(prData.pr_details)) {
            fixed.pr_details = prData.pr_details.filter(pr => 
                pr && typeof pr === 'object' && pr.id && pr.title && pr.author
            ).map(pr => ({
                ...pr,
                lifetime_days: Math.max(0, parseInt(pr.lifetime_days) || 0),
                num_comments: Math.max(0, parseInt(pr.num_comments) || 0)
            }));
        }

        return fixed;
    }
}

module.exports = DataProcessor;