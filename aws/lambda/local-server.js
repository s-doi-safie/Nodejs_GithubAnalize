#!/usr/bin/env node

/**
 * ローカル開発サーバー
 * AWS Lambda関数をローカルでテストするためのExpressサーバー
 */

const express = require('express');
const path = require('path');

// Lambda handlerをインポート
const { handler } = require('./index.js');

const app = express();
const PORT = process.env.PORT || 3000;

// JSON body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS設定（開発用）
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Lambda関数をExpressミドルウェアとして使用
app.use(async (req, res) => {
  try {
    console.log(`${req.method} ${req.path} - ${new Date().toISOString()}`);
    
    // Lambda イベントオブジェクトを構築
    const event = {
      httpMethod: req.method,
      path: req.path,
      queryStringParameters: req.query || {},
      headers: req.headers || {},
      body: req.method !== 'GET' && req.body ? JSON.stringify(req.body) : null,
      isBase64Encoded: false,
      requestContext: {
        requestId: `local-${Date.now()}`,
        stage: 'local',
        httpMethod: req.method,
        path: req.path,
        identity: {
          sourceIp: req.ip || '127.0.0.1'
        }
      }
    };

    // Lambda コンテキストオブジェクト
    const context = {
      getRemainingTimeInMillis: () => 30000,
      functionName: 'github-analyzer-handler',
      functionVersion: '$LATEST',
      invokedFunctionArn: 'arn:aws:lambda:local:000000000000:function:github-analyzer-handler',
      memoryLimitInMB: 384,
      awsRequestId: `local-${Date.now()}`
    };

    // Lambda関数を実行
    const result = await handler(event, context);
    
    // レスポンスを返す
    if (result.statusCode) {
      res.status(result.statusCode);
      
      // ヘッダーを設定
      if (result.headers) {
        Object.keys(result.headers).forEach(key => {
          res.set(key, result.headers[key]);
        });
      }
      
      // Base64エンコードされたレスポンスをデコード
      if (result.isBase64Encoded && result.body) {
        const buffer = Buffer.from(result.body, 'base64');
        res.send(buffer);
      } else {
        res.send(result.body || '');
      }
    } else {
      res.status(500).json({ error: 'Invalid Lambda response format' });
    }

  } catch (error) {
    console.error('Lambda execution error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// サーバー起動
app.listen(PORT, () => {
  console.log('🚀 GitHub Analyzer Local Development Server');
  console.log(`📍 Server running at: http://localhost:${PORT}`);
  console.log(`🌐 Bundle mode: ${process.env.ENABLE_BUNDLE === 'true' ? 'ENABLED' : 'DISABLED'}`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  /                    - Main application (bundled or regular)');
  console.log('  GET  /api/health         - Health check');
  console.log('  GET  /api/review-data    - Review data');
  console.log('  GET  /api/teams          - Team information');
  console.log('  POST /run-python         - Fetch GitHub data');
  console.log('  POST /update-teams       - Update team information');
  console.log('');
  console.log('Press Ctrl+C to stop the server');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down server gracefully...');
  process.exit(0);
});

module.exports = app;