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
  description = "AWS リージョン"
  type        = string
  default     = "ap-northeast-1"
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

# Lambda設定
variable "lambda_timeout" {
  description = "Lambda関数のタイムアウト秒数"
  type        = number
  default     = 60

  validation {
    condition     = var.lambda_timeout >= 1 && var.lambda_timeout <= 900
    error_message = "Lambda timeout must be between 1 and 900 seconds."
  }
}

variable "lambda_memory_size" {
  description = "Lambda関数のメモリサイズ (MB)"
  type        = number
  default     = 512

  validation {
    condition     = var.lambda_memory_size >= 128 && var.lambda_memory_size <= 10240
    error_message = "Lambda memory size must be between 128 and 10240 MB."
  }
}

# DynamoDB設定
variable "enable_dynamodb_backup" {
  description = "DynamoDB Point-in-Time Recovery を有効にするか"
  type        = bool
  default     = false
}

# CloudWatch Logs設定
variable "log_retention_days" {
  description = "CloudWatch Logs の保持日数"
  type        = number
  default     = 14

  validation {
    condition = contains([
      1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1827, 3653
    ], var.log_retention_days)
    error_message = "Log retention days must be a valid CloudWatch Logs retention value."
  }
}

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