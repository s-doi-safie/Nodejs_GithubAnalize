const path = require('path');
const fs = require('fs').promises;
const mime = require('mime-types');
const apiRouter = require('./routes/api');
const staticRouter = require('./routes/static');

/**
 * AWS Lambda メインハンドラー
 * 静的ファイル配信とAPI処理を統合
 */
exports.handler = async (event, context) => {
    try {
        console.log('Event:', JSON.stringify(event, null, 2));
        
        const { httpMethod, path: requestPath, headers, body, queryStringParameters } = event;
        
        // CORSヘッダーを設定
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
        };
        
        // OPTIONSリクエスト（プリフライト）の処理
        if (httpMethod === 'OPTIONS') {
            return {
                statusCode: 200,
                headers: corsHeaders,
                body: ''
            };
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
            
            return {
                statusCode: response.statusCode,
                headers: { ...corsHeaders, ...response.headers },
                body: JSON.stringify(response.body)
            };
        }
        
        // 静的ファイルの処理
        const response = await staticRouter.handle({
            httpMethod,
            path: requestPath,
            headers
        });
        
        return {
            statusCode: response.statusCode,
            headers: { ...corsHeaders, ...response.headers },
            body: response.body,
            isBase64Encoded: response.isBase64Encoded || false
        };
        
    } catch (error) {
        console.error('Lambda error:', error);
        
        return {
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
    }
};