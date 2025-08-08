const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../services/s3-logger');
const { getBundler } = require('../utils/html-bundler');

/**
 * 静的ファイル配信ルーター
 * HTML, CSS, JS, 画像等の静的ファイルを配信
 */
class StaticRouter {
    constructor() {
        this.publicDir = path.join(__dirname, '..', 'public');
        this.bundler = getBundler();
        
        // キャッシュ設定
        this.cacheSettings = {
            'text/html': 'no-cache', // バンドルファイルはキャッシュしない
            'text/css': 'public, max-age=31536000', // 1年
            'application/javascript': 'public, max-age=31536000', // 1年
            'image/': 'public, max-age=2592000', // 30日
            'application/json': 'no-cache',
            'default': 'public, max-age=3600' // 1時間
        };
        
        // バンドルモード設定
        this.bundleMode = process.env.ENABLE_BUNDLE === 'true' || process.env.NODE_ENV === 'production';
    }

    /**
     * 静的ファイルリクエストを処理
     */
    async handle(request) {
        const { path: requestPath } = request;

        try {
            // ルートパスの場合はindex.htmlを返す
            let filePath = requestPath === '/' ? '/index.html' : requestPath;
            
            // バンドルモードでindex.htmlリクエストの場合
            if (this.bundleMode && (filePath === '/index.html' || requestPath === '/')) {
                return await this.serveBundledHtml();
            }
            
            // セキュリティ: パストラバーサル攻撃を防ぐ
            if (filePath.includes('..') || filePath.includes('//')) {
                return this.createErrorResponse(400, 'Invalid file path');
            }

            // ファイルの存在確認と読み込み
            const fileResult = await this.readFile(filePath);
            
            if (!fileResult.exists) {
                // ファイルが見つからない場合、SPAの場合はindex.htmlにフォールバック
                if (this.shouldFallbackToIndex(filePath)) {
                    // バンドルモードではバンドルされたHTMLを返す
                    if (this.bundleMode) {
                        return await this.serveBundledHtml();
                    }
                    
                    const indexResult = await this.readFile('/index.html');
                    if (indexResult.exists) {
                        return this.createFileResponse(indexResult.content, 'text/html');
                    }
                }
                
                return this.createErrorResponse(404, 'File not found');
            }

            // MIME タイプを判定
            const mimeType = this.getMimeType(filePath);
            
            return this.createFileResponse(fileResult.content, mimeType, fileResult.isBase64);

        } catch (error) {
            logger.error(error, { context: 'Static file serving', path: requestPath });
            return this.createErrorResponse(500, 'Internal server error');
        }
    }

    /**
     * バンドルされたHTMLを配信
     */
    async serveBundledHtml() {
        try {
            logger.info('Serving bundled HTML');
            
            const bundledHtml = await this.bundler.createBundle();
            const bundleStats = await this.bundler.getBundleStats();
            
            logger.info('Bundle served successfully', {
                originalFiles: bundleStats?.original.fileCount || 0,
                bundledSize: bundleStats?.bundled.sizeFormatted || '0 KB',
                reduction: bundleStats?.optimization.reductionPercentage || '0%'
            });
            
            return {
                statusCode: 200,
                headers: {
                    'Content-Type': 'text/html',
                    'Cache-Control': 'no-cache',
                    'X-Bundle-Mode': 'enabled',
                    'X-Bundle-Files': bundleStats?.original.fileCount?.toString() || '0',
                    'X-Bundle-Reduction': bundleStats?.optimization.reductionPercentage || '0%',
                    'X-Content-Type-Options': 'nosniff',
                    'X-Frame-Options': 'DENY',
                    'X-XSS-Protection': '1; mode=block',
                    'Referrer-Policy': 'strict-origin-when-cross-origin'
                },
                body: bundledHtml
            };
            
        } catch (error) {
            logger.error(error, { context: 'serveBundledHtml' });
            
            // フォールバック: 通常のindex.htmlを配信
            return await this.serveRegularFile('/index.html');
        }
    }
    
    /**
     * 通常ファイルを配信
     */
    async serveRegularFile(filePath) {
        const fileResult = await this.readFile(filePath);
        
        if (!fileResult.exists) {
            return this.createErrorResponse(404, 'File not found');
        }
        
        const mimeType = this.getMimeType(filePath);
        return this.createFileResponse(fileResult.content, mimeType, fileResult.isBase64);
    }

    /**
     * ファイルを読み込み
     */
    async readFile(filePath) {
        try {
            const fullPath = path.join(this.publicDir, filePath);
            const stats = await fs.stat(fullPath);
            
            if (!stats.isFile()) {
                return { exists: false };
            }

            // ファイルタイプに応じて読み込み方法を変更
            const mimeType = this.getMimeType(filePath);
            const isBase64 = this.shouldEncodeAsBase64(mimeType);

            const content = await fs.readFile(fullPath, isBase64 ? null : 'utf8');
            
            return {
                exists: true,
                content: isBase64 ? content.toString('base64') : content,
                isBase64: isBase64,
                size: stats.size,
                mtime: stats.mtime
            };

        } catch (error) {
            if (error.code === 'ENOENT') {
                return { exists: false };
            }
            throw error;
        }
    }

    /**
     * ファイルのMIMEタイプを取得（mime-typesなしで実装）
     */
    getMimeType(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeMap = {
            '.html': 'text/html',
            '.htm': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.mjs': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.otf': 'font/otf',
            '.eot': 'application/vnd.ms-fontobject',
            '.txt': 'text/plain',
            '.xml': 'application/xml',
            '.pdf': 'application/pdf',
            '.zip': 'application/zip',
            '.gz': 'application/gzip',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg'
        };

        return mimeMap[ext] || 'application/octet-stream';
    }

    /**
     * Base64エンコードが必要かどうかを判定
     */
    shouldEncodeAsBase64(mimeType) {
        return mimeType.startsWith('image/') || 
               mimeType.startsWith('font/') || 
               mimeType === 'application/vnd.ms-fontobject' ||
               mimeType === 'application/octet-stream';
    }

    /**
     * SPAのindex.htmlフォールバックが必要かどうかを判定
     */
    shouldFallbackToIndex(filePath) {
        // ファイル拡張子がない場合はSPAルートとして扱う
        const ext = path.extname(filePath);
        return !ext && !filePath.startsWith('/api/');
    }

    /**
     * キャッシュ制御ヘッダーを取得
     */
    getCacheControl(mimeType) {
        for (const [type, control] of Object.entries(this.cacheSettings)) {
            if (mimeType.startsWith(type)) {
                return control;
            }
        }
        return this.cacheSettings.default;
    }

    /**
     * ファイルレスポンスを作成
     */
    createFileResponse(content, mimeType, isBase64 = false) {
        const headers = {
            'Content-Type': mimeType,
            'Cache-Control': this.getCacheControl(mimeType)
        };

        // セキュリティヘッダー
        if (mimeType === 'text/html') {
            headers['X-Frame-Options'] = 'DENY';
            headers['X-Content-Type-Options'] = 'nosniff';
            headers['X-XSS-Protection'] = '1; mode=block';
            headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
            headers['X-Bundle-Mode'] = this.bundleMode ? 'enabled' : 'disabled';
        }

        return {
            statusCode: 200,
            headers: headers,
            body: content,
            isBase64Encoded: isBase64
        };
    }

    /**
     * エラーレスポンスを作成
     */
    createErrorResponse(statusCode, message) {
        // 簡易的なHTMLエラーページ
        const errorHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Error ${statusCode}</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px;
            background-color: #f5f5f5;
        }
        .error-container {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-width: 500px;
            margin: 0 auto;
        }
        h1 { color: #dc3545; }
        p { color: #666; }
        a { color: #007bff; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>Error ${statusCode}</h1>
        <p>${message}</p>
        <p><a href="/">← Back to Home</a></p>
    </div>
</body>
</html>`;

        return {
            statusCode: statusCode,
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'no-cache'
            },
            body: errorHtml
        };
    }

    /**
     * ファイル一覧を取得（デバッグ用）
     */
    async getFileList() {
        try {
            const files = [];
            
            const readDirectory = async (dir, prefix = '') => {
                const entries = await fs.readdir(path.join(this.publicDir, dir), { withFileTypes: true });
                
                for (const entry of entries) {
                    const relativePath = path.join(prefix, entry.name);
                    
                    if (entry.isDirectory()) {
                        await readDirectory(path.join(dir, entry.name), relativePath);
                    } else {
                        const fullPath = path.join(this.publicDir, dir, entry.name);
                        const stats = await fs.stat(fullPath);
                        
                        files.push({
                            path: '/' + relativePath.replace(/\\/g, '/'),
                            size: stats.size,
                            mtime: stats.mtime.toISOString(),
                            mimeType: this.getMimeType(entry.name)
                        });
                    }
                }
            };

            await readDirectory('');
            return files;

        } catch (error) {
            logger.error(error, { context: 'getFileList' });
            return [];
        }
    }

    /**
     * 健全性チェック
     */
    async healthCheck() {
        try {
            // index.htmlの存在確認
            const indexResult = await this.readFile('/index.html');
            
            // 基本的な静的ファイルの存在確認
            const essentialFiles = ['/styles.css', '/js/controllers/GitHubAnalyzerController.js'];
            const fileChecks = {};
            
            for (const file of essentialFiles) {
                const result = await this.readFile(file);
                fileChecks[file] = result.exists;
            }
            
            // バンドル情報
            let bundleInfo = null;
            if (this.bundleMode) {
                try {
                    const bundleStats = await this.bundler.getBundleStats();
                    bundleInfo = {
                        enabled: true,
                        originalFiles: bundleStats?.original.fileCount || 0,
                        bundledSize: bundleStats?.bundled.sizeFormatted || '0 KB',
                        reduction: bundleStats?.optimization.reductionPercentage || '0%',
                        cacheStats: this.bundler.getCacheStats()
                    };
                } catch (bundleError) {
                    bundleInfo = {
                        enabled: true,
                        error: bundleError.message
                    };
                }
            }

            return {
                success: indexResult.exists && Object.values(fileChecks).every(exists => exists),
                index_html: indexResult.exists,
                files: fileChecks,
                public_dir: this.publicDir,
                bundle_mode: this.bundleMode,
                bundle_info: bundleInfo
            };

        } catch (error) {
            logger.error(error, { context: 'Static router health check' });
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * バンドルモードの切り替え
     */
    toggleBundleMode(enabled) {
        this.bundleMode = enabled;
        if (enabled) {
            this.bundler.clearCache(); // キャッシュをクリアして新しいバンドルを作成
        }
        logger.info(`Bundle mode ${enabled ? 'enabled' : 'disabled'}`);
    }
    
    /**
     * バンドルキャッシュをクリア
     */
    clearBundleCache() {
        this.bundler.clearCache();
        logger.info('Bundle cache cleared');
    }
}

module.exports = StaticRouter;