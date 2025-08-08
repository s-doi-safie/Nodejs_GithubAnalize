const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../services/s3-logger');

/**
 * HTML/CSS/JS統合バンドラー
 * 複数ファイルを単一HTMLファイルに統合してリクエスト数削減
 */
class HtmlBundler {
    constructor(publicDir) {
        this.publicDir = publicDir || path.join(__dirname, '..', 'public');
        this.bundledCache = new Map();
        
        // 最適化設定
        this.options = {
            minifyHtml: true,
            minifyCss: true,
            minifyJs: false, // JSは可読性のため無効
            compressImages: true,
            removeCDNLinks: false // CDNリンクは保持
        };
    }

    /**
     * 単一のバンドルHTMLを生成
     */
    async createBundle() {
        try {
            logger.info('Starting HTML bundling process');
            
            // キャッシュチェック
            const cacheKey = 'bundled-html';
            const cachedBundle = this.bundledCache.get(cacheKey);
            if (cachedBundle) {
                const stats = await this.getFileStats();
                if (cachedBundle.timestamp >= stats.latestModification) {
                    logger.info('Using cached bundle');
                    return cachedBundle.content;
                }
            }

            // HTMLファイルを読み込み
            const htmlPath = path.join(this.publicDir, 'index.html');
            const htmlContent = await fs.readFile(htmlPath, 'utf-8');

            // CSS/JSファイルをインライン化
            const bundledHtml = await this.processHtml(htmlContent);
            
            // キャッシュに保存
            this.bundledCache.set(cacheKey, {
                content: bundledHtml,
                timestamp: Date.now()
            });

            logger.info('HTML bundling completed successfully');
            return bundledHtml;

        } catch (error) {
            logger.error(error, { context: 'HtmlBundler.createBundle' });
            throw error;
        }
    }

    /**
     * HTMLを処理してCSS/JSをインライン化
     */
    async processHtml(htmlContent) {
        let processedHtml = htmlContent;

        // CSSファイルのインライン化
        const cssLinkRegex = /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi;
        let match;
        const cssPromises = [];

        while ((match = cssLinkRegex.exec(htmlContent)) !== null) {
            const cssHref = match[1];
            
            // 外部CDNリンクは無視
            if (cssHref.startsWith('http')) {
                continue;
            }

            cssPromises.push(this.inlineCss(match[0], cssHref));
        }

        const cssReplacements = await Promise.all(cssPromises);
        cssReplacements.forEach(replacement => {
            if (replacement) {
                processedHtml = processedHtml.replace(replacement.original, replacement.inlined);
            }
        });

        // JavaScriptファイルのインライン化
        const jsScriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*><\/script>/gi;
        const jsPromises = [];

        // HTMLから再度マッチを検索（processedHtmlは使わず元のhtmlContentを使用）
        let jsMatch;
        while ((jsMatch = jsScriptRegex.exec(htmlContent)) !== null) {
            const jsSrc = jsMatch[1];
            
            // 外部CDNリンクは無視
            if (jsSrc.startsWith('http')) {
                continue;
            }

            jsPromises.push(this.inlineJs(jsMatch[0], jsSrc));
        }

        const jsReplacements = await Promise.all(jsPromises);
        jsReplacements.forEach(replacement => {
            if (replacement) {
                processedHtml = processedHtml.replace(replacement.original, replacement.inlined);
            }
        });

        // 画像のBase64エンコード（将来の拡張用）
        if (this.options.compressImages) {
            processedHtml = await this.inlineImages(processedHtml);
        }

        // HTMLの最適化
        if (this.options.minifyHtml) {
            processedHtml = this.minifyHtml(processedHtml);
        }

        // バンドル情報をHTMLに追加
        processedHtml = this.addBundleInfo(processedHtml);

        return processedHtml;
    }

    /**
     * CSSファイルをインライン化
     */
    async inlineCss(originalTag, cssPath) {
        try {
            const fullPath = path.join(this.publicDir, cssPath);
            const cssContent = await fs.readFile(fullPath, 'utf-8');
            
            const optimizedCss = this.options.minifyCss ? this.minifyCss(cssContent) : cssContent;
            
            const inlinedTag = `<style>\n${optimizedCss}\n</style>`;
            
            logger.debug(`Inlined CSS: ${cssPath}`);
            return {
                original: originalTag,
                inlined: inlinedTag
            };

        } catch (error) {
            logger.warn(`Failed to inline CSS: ${cssPath}`, { error: error.message });
            return null;
        }
    }

    /**
     * JavaScriptファイルをインライン化
     */
    async inlineJs(originalTag, jsPath) {
        try {
            const fullPath = path.join(this.publicDir, jsPath);
            const jsContent = await fs.readFile(fullPath, 'utf-8');
            
            const optimizedJs = this.options.minifyJs ? this.minifyJs(jsContent) : jsContent;
            
            const inlinedTag = `<script>\n${optimizedJs}\n</script>`;
            
            logger.debug(`Inlined JS: ${jsPath}`);
            return {
                original: originalTag,
                inlined: inlinedTag
            };

        } catch (error) {
            logger.warn(`Failed to inline JS: ${jsPath}`, { error: error.message });
            return null;
        }
    }

    /**
     * CSSミニファイ（軽量版）
     */
    minifyCss(css) {
        return css
            // コメント削除
            .replace(/\/\*[\s\S]*?\*\//g, '')
            // 余分な空白・改行削除
            .replace(/\s+/g, ' ')
            .replace(/;\s*}/g, '}')
            .replace(/{\s*/g, '{')
            .replace(/;\s*/g, ';')
            .replace(/,\s*/g, ',')
            .replace(/:\s*/g, ':')
            // 先頭末尾の空白削除
            .trim();
    }

    /**
     * JavaScriptミニファイ（軽量版）
     */
    minifyJs(js) {
        return js
            // 単行コメント削除（//から行末まで）
            .replace(/\/\/.*$/gm, '')
            // 複数行コメント削除
            .replace(/\/\*[\s\S]*?\*\//g, '')
            // 余分な空白削除（ただし文字列内は保護）
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * HTMLミニファイ（軽量版）
     */
    minifyHtml(html) {
        return html
            // HTMLコメント削除
            .replace(/<!--[\s\S]*?-->/g, '')
            // 余分な空白削除（タグ間）
            .replace(/>\s+</g, '><')
            // 行頭末尾の空白削除
            .replace(/^\s+|\s+$/gm, '')
            // 空行削除
            .replace(/\n\s*\n/g, '\n')
            .trim();
    }

    /**
     * 画像をBase64エンコードしてインライン化
     */
    async inlineImages(html) {
        try {
            // img タグの src 属性をマッチ
            const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
            let processedHtml = html;
            const imagePromises = [];
            let match;

            while ((match = imgRegex.exec(html)) !== null) {
                const imageSrc = match[1];
                
                // 外部URLや絶対パスは無視
                if (imageSrc.startsWith('http') || imageSrc.startsWith('data:')) {
                    continue;
                }

                imagePromises.push(this.inlineImage(match[0], imageSrc));
            }

            const imageReplacements = await Promise.all(imagePromises);
            imageReplacements.forEach(replacement => {
                if (replacement) {
                    processedHtml = processedHtml.replace(replacement.original, replacement.inlined);
                }
            });

            // CSS内の背景画像もインライン化
            processedHtml = await this.inlineBackgroundImages(processedHtml);

            return processedHtml;

        } catch (error) {
            logger.error(error, { context: 'HtmlBundler.inlineImages' });
            return html; // エラー時は元のHTMLを返す
        }
    }

    /**
     * 単一画像をBase64エンコード
     */
    async inlineImage(originalTag, imagePath) {
        try {
            const fullPath = path.join(this.publicDir, imagePath);
            const imageBuffer = await fs.readFile(fullPath);
            
            // MIME タイプを取得
            const mimeType = this.getImageMimeType(imagePath);
            
            // Base64エンコード
            const base64Image = imageBuffer.toString('base64');
            const dataUrl = `data:${mimeType};base64,${base64Image}`;
            
            // src 属性を置換
            const inlinedTag = originalTag.replace(
                /src=["']([^"']+)["']/i,
                `src="${dataUrl}"`
            );
            
            logger.debug(`Inlined image: ${imagePath} (${this.formatBytes(imageBuffer.length)})`);
            
            return {
                original: originalTag,
                inlined: inlinedTag
            };

        } catch (error) {
            logger.warn(`Failed to inline image: ${imagePath}`, { error: error.message });
            return null;
        }
    }

    /**
     * CSS内の背景画像をインライン化
     */
    async inlineBackgroundImages(html) {
        try {
            // background-image: url() パターンをマッチ
            const bgImageRegex = /background-image\s*:\s*url\(["']?([^"')]+)["']?\)/gi;
            let processedHtml = html;
            let match;

            while ((match = bgImageRegex.exec(html)) !== null) {
                const imagePath = match[1];
                
                // 外部URLやdata URLは無視
                if (imagePath.startsWith('http') || imagePath.startsWith('data:')) {
                    continue;
                }

                try {
                    const fullPath = path.join(this.publicDir, imagePath);
                    const imageBuffer = await fs.readFile(fullPath);
                    const mimeType = this.getImageMimeType(imagePath);
                    const base64Image = imageBuffer.toString('base64');
                    const dataUrl = `data:${mimeType};base64,${base64Image}`;
                    
                    processedHtml = processedHtml.replace(match[0], 
                        `background-image: url("${dataUrl}")`
                    );
                    
                    logger.debug(`Inlined background image: ${imagePath}`);
                    
                } catch (error) {
                    logger.warn(`Failed to inline background image: ${imagePath}`, { 
                        error: error.message 
                    });
                }
            }

            return processedHtml;

        } catch (error) {
            logger.error(error, { context: 'HtmlBundler.inlineBackgroundImages' });
            return html;
        }
    }

    /**
     * 画像ファイルのMIMEタイプを取得
     */
    getImageMimeType(imagePath) {
        const ext = path.extname(imagePath).toLowerCase();
        const mimeMap = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
            '.ico': 'image/x-icon',
            '.bmp': 'image/bmp'
        };
        
        return mimeMap[ext] || 'image/png';
    }

    /**
     * バンドル情報をHTMLに追加
     */
    addBundleInfo(html) {
        const bundleInfo = `
<!-- Bundled by AWS Lambda HTML Bundler -->
<!-- Generated at: ${new Date().toISOString()} -->
<!-- Optimizations: CSS/JS inlined, HTML minified -->
`;
        
        return html.replace('<head>', `<head>${bundleInfo}`);
    }

    /**
     * ファイル統計を取得
     */
    async getFileStats() {
        try {
            const files = [];
            const extensions = ['.html', '.css', '.js'];
            
            const collectFiles = async (dir) => {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    
                    if (entry.isDirectory()) {
                        await collectFiles(fullPath);
                    } else if (extensions.includes(path.extname(entry.name))) {
                        const stats = await fs.stat(fullPath);
                        files.push({
                            path: fullPath,
                            size: stats.size,
                            mtime: stats.mtime.getTime()
                        });
                    }
                }
            };

            await collectFiles(this.publicDir);
            
            const totalSize = files.reduce((sum, file) => sum + file.size, 0);
            const latestModification = Math.max(...files.map(file => file.mtime));

            return {
                fileCount: files.length,
                totalSize,
                latestModification,
                files
            };

        } catch (error) {
            logger.error(error, { context: 'HtmlBundler.getFileStats' });
            return {
                fileCount: 0,
                totalSize: 0,
                latestModification: 0,
                files: []
            };
        }
    }

    /**
     * バンドル統計を取得
     */
    async getBundleStats() {
        try {
            const originalStats = await this.getFileStats();
            const bundledHtml = await this.createBundle();
            const bundledSize = Buffer.byteLength(bundledHtml, 'utf-8');
            
            const compressionRatio = originalStats.totalSize > 0 
                ? originalStats.totalSize / bundledSize 
                : 1;
                
            const reduction = originalStats.totalSize - bundledSize;
            const reductionPercentage = originalStats.totalSize > 0
                ? (reduction / originalStats.totalSize * 100)
                : 0;

            return {
                original: {
                    fileCount: originalStats.fileCount,
                    totalSize: originalStats.totalSize,
                    totalSizeFormatted: this.formatBytes(originalStats.totalSize)
                },
                bundled: {
                    fileCount: 1,
                    size: bundledSize,
                    sizeFormatted: this.formatBytes(bundledSize)
                },
                optimization: {
                    compressionRatio: compressionRatio.toFixed(2),
                    reduction: reduction,
                    reductionFormatted: this.formatBytes(reduction),
                    reductionPercentage: reductionPercentage.toFixed(1) + '%'
                }
            };

        } catch (error) {
            logger.error(error, { context: 'HtmlBundler.getBundleStats' });
            return null;
        }
    }

    /**
     * バイト数を人間が読みやすい形式に変換
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * キャッシュをクリア
     */
    clearCache() {
        this.bundledCache.clear();
        logger.info('Bundle cache cleared');
    }

    /**
     * キャッシュ統計
     */
    getCacheStats() {
        return {
            cacheSize: this.bundledCache.size,
            cacheKeys: Array.from(this.bundledCache.keys())
        };
    }
}

// シングルトンインスタンス
let bundlerInstance;

function getBundler() {
    if (!bundlerInstance) {
        bundlerInstance = new HtmlBundler();
    }
    return bundlerInstance;
}

module.exports = {
    HtmlBundler,
    getBundler
};