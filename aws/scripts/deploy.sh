#!/bin/bash

# GitHub Analyzer AWS Deployment Script
# このスクリプトはTerraformを使用してAWSリソースをデプロイします

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

# ヘルプメッセージ
show_help() {
    echo "GitHub Analyzer AWS Deployment Script"
    echo
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo
    echo "Commands:"
    echo "  init        Initialize Terraform"
    echo "  plan        Create Terraform execution plan"
    echo "  apply       Apply Terraform configuration"
    echo "  destroy     Destroy Terraform-managed resources"
    echo "  output      Show Terraform outputs"
    echo "  validate    Validate Terraform configuration"
    echo "  build       Build Lambda package only"
    echo "  deploy      Full deployment (build + apply)"
    echo
    echo "Options:"
    echo "  -e, --env ENVIRONMENT    Target environment (dev, staging, production)"
    echo "  -r, --region REGION      AWS region (default: ap-northeast-1)"
    echo "  -y, --yes               Auto-approve Terraform apply"
    echo "  -v, --verbose           Verbose output"
    echo "  --var-file FILE         Use specific tfvars file"
    echo "  --skip-build            Skip Lambda build step"
    echo "  --help                  Show this help message"
    echo
    echo "Examples:"
    echo "  $0 deploy --env dev"
    echo "  $0 plan --env production --var-file prod.tfvars"
    echo "  $0 apply --env staging --yes"
}

# デフォルト値
ENVIRONMENT="dev"
AWS_REGION="ap-northeast-1"
COMMAND=""
AUTO_APPROVE=""
VERBOSE=""
VAR_FILE=""
SKIP_BUILD=""

# 引数の解析
while [[ $# -gt 0 ]]; do
    case $1 in
        init|plan|apply|destroy|output|validate|build|deploy)
            COMMAND="$1"
            shift
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--region)
            AWS_REGION="$2"
            shift 2
            ;;
        -y|--yes)
            AUTO_APPROVE="-auto-approve"
            shift
            ;;
        -v|--verbose)
            VERBOSE="1"
            shift
            ;;
        --var-file)
            VAR_FILE="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD="1"
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

# コマンドが指定されていない場合
if [ -z "$COMMAND" ]; then
    log_error "No command specified"
    show_help
    exit 1
fi

# 環境の検証
case $ENVIRONMENT in
    dev|staging|production)
        ;;
    *)
        log_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or production."
        exit 1
        ;;
esac

# スクリプトのディレクトリを基準にパスを設定
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_DIR="$(dirname "$SCRIPT_DIR")"
LAMBDA_DIR="$AWS_DIR/lambda"
TERRAFORM_DIR="$AWS_DIR/terraform"

log_info "GitHub Analyzer AWS Deployment"
log_info "Environment: $ENVIRONMENT"
log_info "Region: $AWS_REGION"
log_info "Command: $COMMAND"

# 必要なディレクトリの存在確認
for dir in "$LAMBDA_DIR" "$TERRAFORM_DIR"; do
    if [ ! -d "$dir" ]; then
        log_error "Directory not found: $dir"
        exit 1
    fi
done

# 必要なコマンドの確認
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 command not found. Please install $1."
        exit 1
    fi
}

check_command "terraform"
check_command "aws"

# AWS認証の確認
log_info "Checking AWS credentials..."
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    log_error "AWS credentials not configured or invalid"
    log_info "Please run: aws configure"
    exit 1
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
log_success "AWS authenticated. Account ID: $AWS_ACCOUNT_ID"

# Terraformバージョンの確認
TERRAFORM_VERSION=$(terraform version -json | grep -o '"terraform_version":"[^"]*' | cut -d'"' -f4)
log_info "Terraform version: $TERRAFORM_VERSION"

# Lambda パッケージのビルド関数
build_lambda() {
    if [ "$SKIP_BUILD" = "1" ]; then
        log_info "Skipping Lambda build step"
        return
    fi

    log_info "Building Lambda package..."
    
    if [ ! -x "$SCRIPT_DIR/build-lambda.sh" ]; then
        log_error "build-lambda.sh not found or not executable"
        exit 1
    fi

    cd "$LAMBDA_DIR"
    
    if [ "$VERBOSE" = "1" ]; then
        "$SCRIPT_DIR/build-lambda.sh" --verbose
    else
        "$SCRIPT_DIR/build-lambda.sh"
    fi
    
    if [ ! -f "$LAMBDA_DIR/deployment.zip" ]; then
        log_error "Lambda deployment package not created"
        exit 1
    fi
    
    log_success "Lambda package built successfully"
}

# Terraform変数ファイルの設定
setup_terraform_vars() {
    cd "$TERRAFORM_DIR"
    
    # 変数ファイルの決定
    if [ -n "$VAR_FILE" ]; then
        if [ ! -f "$VAR_FILE" ]; then
            log_error "Specified var file not found: $VAR_FILE"
            exit 1
        fi
        TFVARS_FILE="$VAR_FILE"
    else
        TFVARS_FILE="terraform.tfvars"
        
        # 環境固有のtfvarsファイルがあるかチェック
        ENV_TFVARS_FILE="${ENVIRONMENT}.tfvars"
        if [ -f "$ENV_TFVARS_FILE" ]; then
            TFVARS_FILE="$ENV_TFVARS_FILE"
        fi
    fi
    
    if [ ! -f "$TFVARS_FILE" ]; then
        log_warning "Terraform vars file not found: $TFVARS_FILE"
        
        if [ -f "terraform.tfvars.example" ]; then
            log_info "Creating $TFVARS_FILE from example..."
            cp terraform.tfvars.example "$TFVARS_FILE"
            log_warning "Please edit $TFVARS_FILE with your actual values before proceeding"
            
            if [ "$COMMAND" = "apply" ] || [ "$COMMAND" = "deploy" ]; then
                log_error "Cannot proceed with apply/deploy without proper tfvars file"
                exit 1
            fi
        fi
    fi
    
    log_info "Using Terraform vars file: $TFVARS_FILE"
    export TF_VAR_FILE="$TFVARS_FILE"
}

# Terraform 初期化
terraform_init() {
    log_info "Initializing Terraform..."
    cd "$TERRAFORM_DIR"
    
    terraform init -backend-config="region=$AWS_REGION"
    
    if [ $? -eq 0 ]; then
        log_success "Terraform initialized successfully"
    else
        log_error "Terraform initialization failed"
        exit 1
    fi
}

# Terraform 実行
run_terraform() {
    cd "$TERRAFORM_DIR"
    setup_terraform_vars
    
    case $COMMAND in
        init)
            terraform_init
            ;;
        validate)
            log_info "Validating Terraform configuration..."
            terraform validate
            log_success "Terraform configuration is valid"
            ;;
        plan)
            terraform_init
            log_info "Creating Terraform execution plan..."
            terraform plan -var-file="$TF_VAR_FILE" -out=tfplan
            log_success "Terraform plan created successfully"
            ;;
        apply)
            terraform_init
            log_info "Applying Terraform configuration..."
            if [ -n "$AUTO_APPROVE" ]; then
                terraform apply -var-file="$TF_VAR_FILE" $AUTO_APPROVE
            else
                terraform apply -var-file="$TF_VAR_FILE"
            fi
            log_success "Terraform apply completed successfully"
            ;;
        destroy)
            terraform_init
            log_warning "This will destroy all Terraform-managed resources!"
            read -p "Are you sure? Type 'yes' to confirm: " -r
            if [[ $REPLY = "yes" ]]; then
                terraform destroy -var-file="$TF_VAR_FILE" $AUTO_APPROVE
                log_success "Resources destroyed successfully"
            else
                log_info "Destroy cancelled"
            fi
            ;;
        output)
            log_info "Terraform outputs:"
            terraform output
            ;;
        build)
            build_lambda
            ;;
        deploy)
            build_lambda
            terraform_init
            log_info "Deploying infrastructure..."
            
            # Plan first
            terraform plan -var-file="$TF_VAR_FILE" -out=tfplan
            
            if [ -z "$AUTO_APPROVE" ]; then
                read -p "Proceed with deployment? (y/N): " -r
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    log_info "Deployment cancelled"
                    exit 0
                fi
            fi
            
            terraform apply -var-file="$TF_VAR_FILE" $AUTO_APPROVE
            
            # 出力情報を表示
            echo
            log_success "Deployment completed successfully!"
            echo
            log_info "Infrastructure outputs:"
            terraform output
            
            # ヘルスチェック
            API_URL=$(terraform output -raw api_gateway_url 2>/dev/null || echo "")
            if [ -n "$API_URL" ]; then
                echo
                log_info "Performing health check..."
                if curl -f -s "${API_URL}/api/health" > /dev/null 2>&1; then
                    log_success "Health check passed"
                else
                    log_warning "Health check failed. API might still be initializing."
                fi
            fi
            ;;
    esac
}

# メイン実行
case $COMMAND in
    build)
        build_lambda
        ;;
    *)
        run_terraform
        ;;
esac

# 完了メッセージ
echo
log_success "Operation completed successfully!"

# 追加情報の表示
if [ "$COMMAND" = "deploy" ] || [ "$COMMAND" = "apply" ]; then
    echo
    log_info "Next steps:"
    echo "1. Test the API endpoints"
    echo "2. Configure your frontend with the new API URL"
    echo "3. Set up monitoring and alerts"
    
    if [ "$ENVIRONMENT" = "production" ]; then
        echo "4. Configure custom domain (if needed)"
        echo "5. Set up backup and disaster recovery"
    fi
fi

exit 0