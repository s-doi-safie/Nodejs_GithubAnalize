/**
 * Chart.js を使用したチャート管理クラス
 */
class ChartManager {
    constructor(canvasId, dataProcessor) {
        this.canvasId = canvasId;
        this.dataProcessor = dataProcessor;
        this.chart = null;
    }

    /**
     * チャートのタイトルを生成
     * @param {Object} data - チャートデータ
     * @param {string} fromDate - 開始日
     * @param {string} toDate - 終了日
     * @returns {string} タイトル文字列
     */
    getChartTitle(data, fromDate, toDate) {
        let title = "Review Activity";

        // チーム名が含まれている場合は、タイトルに追加
        if (data.team) {
            // カンマで区切られた複数のチーム名の場合
            if (data.team.includes(",")) {
                title += ` in ${data.team} Teams`;
            } else {
                title += ` in ${data.team} Team`;
            }
        } else {
            title += " in All Teams";
        }

        title += ` from ${fromDate} to ${toDate}`;

        return title;
    }

    /**
     * チャート設定オプションを作成
     * @param {Object} data - チャートデータ
     * @param {Function} onClickCallback - クリック時のコールバック
     * @returns {Object} チャート設定オプション
     */
    createChartOptions(data, onClickCallback) {
        const fromDate = data["period"][0];
        const toDate = data["period"][1];
        const maxPrNum = this.dataProcessor.calcMaxPrNum(data);

        return {
            responsive: true,
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    max: maxPrNum + 2,
                },
            },
            plugins: {
                title: {
                    display: true,
                    text: this.getChartTitle(data, fromDate, toDate),
                    font: { size: 20 }
                },
                tooltip: {
                    mode: "index",
                    intersect: false,
                },
            }, onClick: (event, elements) => {
                if (elements.length > 0 && onClickCallback) {
                    const index = elements[0].index;
                    const person = data.labels[index];
                    onClickCallback(person);
                }
            },
        };
    }

    /**
     * チャートを作成・更新
     * @param {Object} data - チャートデータ
     * @param {Function} onClickCallback - クリック時のコールバック
     */
    createChart(data, onClickCallback) {
        const ctx = document.getElementById(this.canvasId).getContext("2d");
        const options = this.createChartOptions(data, onClickCallback);

        // 既存のチャートがあれば破棄
        if (this.chart instanceof Chart) {
            this.chart.destroy();
        }

        this.chart = new Chart(ctx, {
            type: "bar",
            data: data,
            options: options,
        });
    }

    /**
     * チャートを破棄
     */
    destroy() {
        if (this.chart instanceof Chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }
}
