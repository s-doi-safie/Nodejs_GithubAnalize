#!/bin/bash

# GitHub Analyzer Lambda Build Script
# このスクリプトはLambda関数をビルドしてデプロイ用のzipファイルを作成します

set -e  # エラー時に終了

# 色付きの出力用
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ログ用の関数
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

# スクリプトのディレクトリを基準にパスを設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_DIR="$(dirname "$SCRIPT_DIR")"
LAMBDA_DIR="$AWS_DIR/lambda"
BUILD_DIR="$LAMBDA_DIR/build"
DEPLOYMENT_ZIP="$LAMBDA_DIR/deployment.zip"

log_info "GitHub Analyzer Lambda Build Script"
log_info "Lambda directory: $LAMBDA_DIR"

# Lambda ディレクトリが存在するかチェック
if [ ! -d "$LAMBDA_DIR" ]; then
    log_error "Lambda directory not found: $LAMBDA_DIR"
    exit 1
fi

cd "$LAMBDA_DIR"

# 既存のデプロイメントファイルを削除
log_info "Cleaning up previous build artifacts..."
rm -f "$DEPLOYMENT_ZIP"
rm -rf "$BUILD_DIR"

# package.json が存在するかチェック
if [ ! -f "package.json" ]; then
    log_error "package.json not found in $LAMBDA_DIR"
    exit 1
fi

# Node.jsのバージョンチェック
NODE_VERSION=$(node --version)
log_info "Node.js version: $NODE_VERSION"

if ! node --version | grep -E "^v1[8-9]\.|^v[2-9][0-9]\." > /dev/null; then
    log_warning "Node.js version might not be compatible with AWS Lambda. Recommended: v18 or v20"
fi

# 依存関係のインストール
log_info "Installing production dependencies..."
if [ -f "package-lock.json" ]; then
    npm ci --production --silent
else
    npm install --production --silent
fi

log_success "Dependencies installed successfully"

# 不要なファイルとディレクトリを特定
log_info "Identifying files to exclude from deployment package..."

# .zipignore ファイルが存在する場合は読み込み
EXCLUDE_PATTERNS=""
if [ -f ".zipignore" ]; then
    log_info "Using .zipignore file for exclusion patterns"
    EXCLUDE_PATTERNS=$(cat .zipignore)
else
    log_info "Creating default exclusion patterns"
    # デフォルトの除外パターン
    cat > .zipignore << EOF
# Development files
*.md
.git*
.env*
*.log
.DS_Store
Thumbs.db

# Test files
test/
tests/
*.test.js
*.spec.js
__tests__/

# Build and cache
build/
dist/
.cache/
node_modules/.cache/

# Documentation
docs/
documentation/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# Coverage reports
coverage/
.nyc_output/

# Linting
.eslintrc*
.prettierrc*

# TypeScript
*.ts
!*.d.ts
tsconfig.json

# Source maps
*.map
EOF
fi

# zip コマンドが利用可能かチェック
if ! command -v zip &> /dev/null; then
    log_error "zip command not found. Please install zip utility."
    exit 1
fi

# Lambda パッケージの作成
log_info "Creating Lambda deployment package..."

# 除外オプションを構築
EXCLUDE_OPTIONS=""
while IFS= read -r pattern; do
    # 空行とコメント行をスキップ
    if [[ -n "$pattern" && ! "$pattern" =~ ^[[:space:]]*# ]]; then
        EXCLUDE_OPTIONS="$EXCLUDE_OPTIONS -x '$pattern'"
    fi
done < .zipignore

# zipファイルを作成（evalを使用して除外オプションを適用）
eval "zip -r '$DEPLOYMENT_ZIP' . $EXCLUDE_OPTIONS" > /dev/null 2>&1

if [ $? -eq 0 ]; then
    log_success "Lambda package created successfully: $DEPLOYMENT_ZIP"
else
    log_error "Failed to create Lambda package"
    exit 1
fi

# パッケージサイズの確認
PACKAGE_SIZE=$(du -h "$DEPLOYMENT_ZIP" | cut -f1)
PACKAGE_SIZE_BYTES=$(stat -f%z "$DEPLOYMENT_ZIP" 2>/dev/null || stat -c%s "$DEPLOYMENT_ZIP" 2>/dev/null)

log_info "Package size: $PACKAGE_SIZE"

# サイズ制限の警告
if [ "$PACKAGE_SIZE_BYTES" -gt 52428800 ]; then  # 50MB
    log_warning "Package size ($PACKAGE_SIZE) exceeds 50MB. Consider optimizing dependencies."
elif [ "$PACKAGE_SIZE_BYTES" -gt 262144000 ]; then  # 250MB
    log_error "Package size ($PACKAGE_SIZE) exceeds Lambda limit of 250MB (unzipped)."
    exit 1
fi

# パッケージの内容確認（オプション）
if [ "$1" = "--verbose" ] || [ "$1" = "-v" ]; then
    log_info "Package contents:"
    unzip -l "$DEPLOYMENT_ZIP" | head -20
    if [ $(unzip -l "$DEPLOYMENT_ZIP" | wc -l) -gt 22 ]; then
        echo "... (more files)"
    fi
fi

# Lambda関数の更新（オプション）
if [ "$1" = "--deploy" ] || [ "$2" = "--deploy" ]; then
    log_info "Deploying Lambda function..."
    
    # AWS CLIの確認
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI to deploy."
        exit 1
    fi
    
    # 関数名の取得（環境変数または引数から）
    FUNCTION_NAME="${LAMBDA_FUNCTION_NAME:-}"
    if [ -z "$FUNCTION_NAME" ]; then
        log_error "Lambda function name not specified. Set LAMBDA_FUNCTION_NAME environment variable."
        exit 1
    fi
    
    log_info "Updating Lambda function: $FUNCTION_NAME"
    
    if aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://$DEPLOYMENT_ZIP" \
        --no-cli-pager > /dev/null; then
        log_success "Lambda function updated successfully"
    else
        log_error "Failed to update Lambda function"
        exit 1
    fi
fi

# セキュリティチェック（環境変数やシークレットの確認）
log_info "Running security checks..."

# zipファイル内でのシークレット検索
TEMP_EXTRACT_DIR=$(mktemp -d)
unzip -q "$DEPLOYMENT_ZIP" -d "$TEMP_EXTRACT_DIR"

# 一般的なシークレットパターンを検索
SECRET_PATTERNS=(
    "password\s*[:=]\s*['\"][^'\"]+['\"]"
    "secret\s*[:=]\s*['\"][^'\"]+['\"]"
    "key\s*[:=]\s*['\"][^'\"]+['\"]"
    "token\s*[:=]\s*['\"][^'\"]+['\"]"
    "aws_access_key_id"
    "aws_secret_access_key"
)

SECRETS_FOUND=false
for pattern in "${SECRET_PATTERNS[@]}"; do
    if grep -r -i -E "$pattern" "$TEMP_EXTRACT_DIR" --exclude-dir=node_modules > /dev/null 2>&1; then
        SECRETS_FOUND=true
        break
    fi
done

if $SECRETS_FOUND; then
    log_warning "Potential secrets detected in package. Please review before deployment."
else
    log_success "No obvious secrets detected in package"
fi

# 一時ディレクトリを削除
rm -rf "$TEMP_EXTRACT_DIR"

# 依存関係の脆弱性チェック（npmがある場合）
if command -v npm &> /dev/null; then
    log_info "Checking for security vulnerabilities..."
    npm audit --audit-level moderate --production 2>/dev/null || log_warning "Some vulnerabilities found. Run 'npm audit' for details."
fi

log_success "Build completed successfully!"
log_info "Deployment package: $DEPLOYMENT_ZIP"
log_info "Package size: $PACKAGE_SIZE"

# 使用方法の表示
if [ "$1" != "--deploy" ] && [ "$2" != "--deploy" ]; then
    echo
    log_info "Usage:"
    echo "  $0 [options]"
    echo "    --verbose, -v    Show package contents"
    echo "    --deploy         Deploy to Lambda (requires LAMBDA_FUNCTION_NAME env var)"
    echo
    log_info "To deploy manually:"
    echo "  export LAMBDA_FUNCTION_NAME=your-function-name"
    echo "  aws lambda update-function-code --function-name \$LAMBDA_FUNCTION_NAME --zip-file fileb://$DEPLOYMENT_ZIP"
fi

exit 0