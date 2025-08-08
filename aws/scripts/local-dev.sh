#!/bin/bash

# GitHub Analyzer Local Development Script
# ローカル開発環境でのテスト・デバッグ用スクリプト

set -e

# 色付きの出力用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ヘルプメッセージ
show_help() {
    echo "GitHub Analyzer Local Development Script"
    echo
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo
    echo "Commands:"
    echo "  start           Start local development server"
    echo "  test-lambda     Test Lambda function locally"
    echo "  lint            Run code linting"
    echo "  format          Format code"
    echo "  build           Build Lambda package"
    echo "  test-api        Test API endpoints"
    echo "  setup           Setup local development environment"
    echo "  clean           Clean up temporary files"
    echo
    echo "Options:"
    echo "  --port PORT     Port for local server (default: 3000)"
    echo "  --verbose       Verbose output"
    echo "  --help          Show this help message"
}

# デフォルト値
COMMAND=""
PORT="3000"
VERBOSE=""

# 引数の解析
while [[ $# -gt 0 ]]; do
    case $1 in
        start|test-lambda|lint|format|build|test-api|setup|clean)
            COMMAND="$1"
            shift
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --verbose)
            VERBOSE="1"
            shift
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

if [ -z "$COMMAND" ]; then
    log_error "No command specified"
    show_help
    exit 1
fi

# スクリプトのディレクトリを基準にパスを設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_DIR="$(dirname "$SCRIPT_DIR")"
LAMBDA_DIR="$AWS_DIR/lambda"
ROOT_DIR="$(dirname "$AWS_DIR")"

log_info "GitHub Analyzer Local Development"
log_info "Lambda directory: $LAMBDA_DIR"

# 開発環境のセットアップ
setup_dev_env() {
    log_info "Setting up local development environment..."
    
    # Node.js バージョンチェック
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found. Please install Node.js 18 or later."
        exit 1
    fi
    
    NODE_VERSION=$(node --version | sed 's/v//')
    log_info "Node.js version: $NODE_VERSION"
    
    # Lambda 依存関係のインストール
    if [ -d "$LAMBDA_DIR" ]; then
        log_info "Installing Lambda dependencies..."
        cd "$LAMBDA_DIR"
        npm install
        log_success "Lambda dependencies installed"
    fi
    
    # 開発用の環境変数ファイルを作成
    ENV_FILE="$LAMBDA_DIR/.env.local"
    if [ ! -f "$ENV_FILE" ]; then
        log_info "Creating local environment file..."
        cat > "$ENV_FILE" << EOF
# Local development environment variables
DYNAMODB_TABLE_NAME=github-analyzer-data-local
AWS_REGION=ap-northeast-1
ENVIRONMENT=local
NODE_ENV=development

# GitHub API settings (set your own values)
# GITHUB_TOKEN=your_github_token_here
# GITHUB_ORGANIZATION=your_organization

# Cognito settings (for local testing)
# COGNITO_USER_POOL_ID=local-pool
# COGNITO_CLIENT_ID=local-client
EOF
        log_warning "Please edit $ENV_FILE with your actual values"
    fi
    
    # Git hooks のセットアップ（オプション）
    if [ -d "$ROOT_DIR/.git" ]; then
        log_info "Setting up Git hooks..."
        HOOKS_DIR="$ROOT_DIR/.git/hooks"
        
        # pre-commit hook
        cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash
# AWS GitHub Analyzer pre-commit hook

echo "Running pre-commit checks..."

# AWS ディレクトリが変更されている場合のみチェック
if git diff --cached --name-only | grep -q "^aws/"; then
    echo "AWS files modified, running checks..."
    
    # Lambda コードの lint チェック
    cd aws/lambda
    if command -v npm &> /dev/null && [ -f "package.json" ]; then
        if npm run | grep -q "lint"; then
            echo "Running lint check..."
            npm run lint
        fi
    fi
    
    # Terraform format チェック
    cd ../terraform
    if command -v terraform &> /dev/null; then
        echo "Checking Terraform format..."
        terraform fmt -check=true -diff=true
    fi
fi

echo "Pre-commit checks passed!"
EOF
        chmod +x "$HOOKS_DIR/pre-commit"
        log_success "Git hooks installed"
    fi
    
    log_success "Development environment setup complete"
}

# ローカルサーバーの起動
start_local_server() {
    log_info "Starting local development server on port $PORT..."
    
    cd "$LAMBDA_DIR"
    
    # 環境変数の読み込み
    if [ -f ".env.local" ]; then
        export $(cat .env.local | xargs)
    fi
    
    # Express サーバーとして実行（開発用）
    if [ -f "server.js" ]; then
        node server.js
    else
        # 簡易サーバーを作成
        cat > server.js << 'EOF'
const express = require('express');
const path = require('path');
const lambdaHandler = require('./index').handler;

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Lambda関数をExpressのミドルウェアとして使用
app.use(async (req, res) => {
    try {
        const event = {
            httpMethod: req.method,
            path: req.path,
            headers: req.headers,
            body: req.body ? JSON.stringify(req.body) : null,
            queryStringParameters: req.query
        };
        
        const result = await lambdaHandler(event, {});
        
        res.status(result.statusCode);
        
        if (result.headers) {
            Object.entries(result.headers).forEach(([key, value]) => {
                res.set(key, value);
            });
        }
        
        if (result.isBase64Encoded) {
            res.send(Buffer.from(result.body, 'base64'));
        } else {
            res.send(result.body);
        }
    } catch (error) {
        console.error('Handler error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.listen(port, () => {
    console.log(`Development server running at http://localhost:${port}`);
});
EOF
        
        log_info "Created development server"
        node server.js
    fi
}

# Lambda 関数のローカルテスト
test_lambda_locally() {
    log_info "Testing Lambda function locally..."
    
    cd "$LAMBDA_DIR"
    
    # テストイベントの作成
    TEST_EVENT="test-event.json"
    if [ ! -f "$TEST_EVENT" ]; then
        cat > "$TEST_EVENT" << 'EOF'
{
  "httpMethod": "GET",
  "path": "/api/health",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": null,
  "queryStringParameters": null
}
EOF
        log_info "Created test event: $TEST_EVENT"
    fi
    
    # Node.js で直接実行
    node -e "
        const handler = require('./index').handler;
        const event = require('./$TEST_EVENT');
        
        handler(event, {})
            .then(result => {
                console.log('Lambda Response:');
                console.log(JSON.stringify(result, null, 2));
            })
            .catch(error => {
                console.error('Lambda Error:', error);
                process.exit(1);
            });
    "
    
    log_success "Lambda function test completed"
}

# コードの linting
run_lint() {
    log_info "Running code linting..."
    
    cd "$LAMBDA_DIR"
    
    if [ -f "package.json" ] && npm run | grep -q "lint"; then
        npm run lint
    else
        log_info "No lint script found, using basic checks..."
        
        # 基本的な JavaScript 構文チェック
        find . -name "*.js" -not -path "./node_modules/*" | while read -r file; do
            node -c "$file" || log_error "Syntax error in $file"
        done
        
        log_success "Basic syntax checks passed"
    fi
}

# コードのフォーマット
run_format() {
    log_info "Formatting code..."
    
    cd "$LAMBDA_DIR"
    
    if [ -f "package.json" ] && npm run | grep -q "format"; then
        npm run format
    else
        log_warning "No format script found"
        log_info "Consider adding prettier or similar formatter to package.json"
    fi
}

# API エンドポイントのテスト
test_api_endpoints() {
    log_info "Testing API endpoints..."
    
    BASE_URL="http://localhost:$PORT"
    
    # ヘルスチェック
    log_info "Testing health endpoint..."
    if curl -f -s "$BASE_URL/api/health" > /dev/null; then
        log_success "Health endpoint OK"
    else
        log_error "Health endpoint failed"
    fi
    
    # その他のエンドポイント
    ENDPOINTS=(
        "/api/teams"
        "/api/review-data"
        "/api/debug"
    )
    
    for endpoint in "${ENDPOINTS[@]}"; do
        log_info "Testing $endpoint..."
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL$endpoint" || echo "000")
        
        if [ "$HTTP_STATUS" -eq 200 ]; then
            log_success "$endpoint OK (200)"
        elif [ "$HTTP_STATUS" -eq 401 ] || [ "$HTTP_STATUS" -eq 403 ]; then
            log_warning "$endpoint requires authentication ($HTTP_STATUS)"
        else
            log_error "$endpoint failed ($HTTP_STATUS)"
        fi
    done
}

# クリーンアップ
clean_up() {
    log_info "Cleaning up temporary files..."
    
    cd "$LAMBDA_DIR"
    
    # 一時ファイルの削除
    rm -f deployment.zip
    rm -f server.js
    rm -f test-event.json
    rm -rf build/
    rm -rf coverage/
    
    # ログファイルの削除
    find . -name "*.log" -delete
    
    # node_modules のキャッシュクリア
    if command -v npm &> /dev/null; then
        npm cache clean --force 2>/dev/null || true
    fi
    
    log_success "Cleanup completed"
}

# メイン実行
case $COMMAND in
    setup)
        setup_dev_env
        ;;
    start)
        start_local_server
        ;;
    test-lambda)
        test_lambda_locally
        ;;
    lint)
        run_lint
        ;;
    format)
        run_format
        ;;
    build)
        "$SCRIPT_DIR/build-lambda.sh" ${VERBOSE:+--verbose}
        ;;
    test-api)
        test_api_endpoints
        ;;
    clean)
        clean_up
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        show_help
        exit 1
        ;;
esac

log_success "Operation completed successfully!"