# 基本設定
variable "project_name" {
  description = "プロジェクト名"
  type        = string
  default     = "github-analyzer"
}

variable "environment" {
  description = "環境名 (dev, staging, production)"
  type        = string
  default     = "dev"
  
  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "aws_region" {
  description = "AWS リージョン（Single Region構成でコスト最適化）"
  type        = string
  default     = "ap-northeast-1"
  
  validation {
    condition = contains([
      "us-east-1", "us-west-2", "eu-west-1", "ap-northeast-1", "ap-southeast-1"
    ], var.aws_region)
    error_message = "Supported regions for cost optimization: us-east-1, us-west-2, eu-west-1, ap-northeast-1, ap-southeast-1."
  }
}

# GitHub設定
variable "github_token" {
  description = "GitHub Personal Access Token"
  type        = string
  sensitive   = true
}

variable "github_organization" {
  description = "GitHub組織名"
  type        = string
}

# Lambda設定（最適化済み固定値）
# タイムアウト: 30秒固定
# メモリサイズ: 384MB固定
# アーキテクチャ: ARM64固定

# DynamoDB設定（Single Region最適化）
variable "enable_dynamodb_backup" {
  description = "DynamoDB Point-in-Time Recovery を有効にするか（コスト削減のためデフォルト無効）"
  type        = bool
  default     = false
}

# Single Region設定
# - Global Tables は使用しない（複数リージョン不要）
# - DynamoDB Streams は無効化
# - Point-in-Time Recovery はデフォルト無効
# - TTL による自動データ削除でストレージコスト削減

# ログ設定
# S3にログを出力（CloudWatch Logs は使用しない）
# S3ライフサイクル: 30日後に自動削除

# Cognito認証設定
variable "enable_cognito_auth" {
  description = "Cognito認証を有効にするか"
  type        = bool
  default     = true
}

variable "email_domain_restriction" {
  description = "許可するメールドメイン (例: company.com)"
  type        = string
  default     = ""
}

variable "cognito_callback_urls" {
  description = "Cognito OAuth コールバックURL一覧"
  type        = list(string)
  default     = ["http://localhost:3000", "https://your-domain.com"]
}

variable "cognito_logout_urls" {
  description = "Cognito OAuth ログアウトURL一覧"
  type        = list(string)
  default     = ["http://localhost:3000", "https://your-domain.com"]
}

# CORS設定
variable "allowed_origins" {
  description = "CORS で許可するオリジン一覧"
  type        = list(string)
  default     = ["*"]
}

# タグ設定
variable "additional_tags" {
  description = "追加のタグ"
  type        = map(string)
  default     = {}
}

# 開発環境設定
variable "enable_debug_endpoints" {
  description = "デバッグ用エンドポイントを有効にするか"
  type        = bool
  default     = false
}

# セキュリティ設定
variable "enable_waf" {
  description = "AWS WAF を有効にするか"
  type        = bool
  default     = false
}

variable "rate_limit_requests_per_minute" {
  description = "1分あたりのリクエスト制限数"
  type        = number
  default     = 100
}

# カスタムドメイン設定（オプション）
variable "custom_domain_name" {
  description = "カスタムドメイン名"
  type        = string
  default     = ""
}

variable "certificate_arn" {
  description = "SSL証明書のARN"
  type        = string
  default     = ""
}

# バックアップ設定
variable "enable_automated_backups" {
  description = "自動バックアップを有効にするか"
  type        = bool
  default     = false
}

variable "backup_retention_days" {
  description = "バックアップ保持日数"
  type        = number
  default     = 7
}

# 監視・アラート設定
variable "enable_monitoring" {
  description = "CloudWatch監視を有効にするか"
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "アラート通知用メールアドレス"
  type        = string
  default     = ""
}

variable "enable_x_ray_tracing" {
  description = "AWS X-Rayトレースを有効にするか"
  type        = bool
  default     = false
}

# パフォーマンス設定
variable "provisioned_concurrency" {
  description = "Lambda関数のプロビジョニングされた同時実行数"
  type        = number
  default     = 0
}

variable "reserved_concurrency" {
  description = "Lambda関数の予約済み同時実行数"
  type        = number
  default     = -1
}