const apiRouter = require('./routes/api');
const staticRouter = require('./routes/static');
const { logger } = require('./services/s3-logger');
const { getCache } = require('./services/cache-manager');

/**
 * AWS Lambda メインハンドラー
 * 静的ファイル配信とAPI処理を統合
 */
exports.handler = async (event, context) => {
    const startTime = Date.now();
    try {
        // リクエストログ
        logger.info('Lambda invoked', {
            path: event.path,
            method: event.httpMethod,
            headers: event.headers
        });
        
        const { httpMethod, path: requestPath, headers, body, queryStringParameters } = event;
        
        // CORSヘッダーを設定
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        };
        
        // OPTIONSリクエスト（プリフライト）の処理
        if (httpMethod === 'OPTIONS') {
            const response = {
                statusCode: 200,
                headers: corsHeaders,
                body: ''
            };
            logger.access(event, response, Date.now() - startTime);
            return response;
        }
        
        // キャッシュチェック（GETリクエストのみ）
        const cache = getCache();
        if (httpMethod === 'GET' && requestPath.startsWith('/api/')) {
            const cacheKey = cache.generateKey(requestPath, queryStringParameters || {});
            const cachedResponse = cache.get(cacheKey);
            
            if (cachedResponse) {
                logger.info('Cache hit', { path: requestPath });
                const response = {
                    statusCode: 200,
                    headers: { ...corsHeaders, 'X-Cache': 'HIT' },
                    body: JSON.stringify(cachedResponse)
                };
                logger.access(event, response, Date.now() - startTime);
                return response;
            }
        }
        
        // APIルートの判定（/apiで始まるパス）
        if (requestPath.startsWith('/api/') || requestPath === '/run-python' || requestPath === '/update-teams') {
            const response = await apiRouter.handle({
                httpMethod,
                path: requestPath,
                headers,
                body: body ? JSON.parse(body) : null,
                queryStringParameters
            });
            
            // キャッシュに保存（GETリクエストで成功時のみ）
            if (httpMethod === 'GET' && response.statusCode === 200) {
                const cacheKey = cache.generateKey(requestPath, queryStringParameters || {});
                cache.set(cacheKey, response.body, 300000); // 5分間キャッシュ
            }
            
            const finalResponse = {
                statusCode: response.statusCode,
                headers: { ...corsHeaders, ...response.headers, 'X-Cache': 'MISS' },
                body: JSON.stringify(response.body)
            };
            
            logger.access(event, finalResponse, Date.now() - startTime);
            return finalResponse;
        }
        
        // 静的ファイルの処理
        const response = await staticRouter.handle({
            httpMethod,
            path: requestPath,
            headers
        });
        
        const finalResponse = {
            statusCode: response.statusCode,
            headers: { ...corsHeaders, ...response.headers },
            body: response.body,
            isBase64Encoded: response.isBase64Encoded || false
        };
        
        logger.access(event, finalResponse, Date.now() - startTime);
        return finalResponse;
        
    } catch (error) {
        logger.error(error, { 
            path: event.path,
            method: event.httpMethod,
            duration: Date.now() - startTime
        });
        
        const errorResponse = {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Internal server error',
                message: error.message
            })
        };
        
        logger.access(event, errorResponse, Date.now() - startTime);
        return errorResponse;
    } finally {
        // メトリクス記録
        logger.metric('lambda_duration', Date.now() - startTime, 'Milliseconds', {
            path: event.path,
            method: event.httpMethod
        });
        
        // キャッシュ統計
        const cacheStats = getCache().getStats();
        logger.metric('cache_hit_rate', parseFloat(cacheStats.hitRate), 'Percent');
        
        // バッファをフラッシュ（非同期で実行）
        setImmediate(() => logger.flush());
    }
};