terraform {
  required_version = ">= 1.0"
  
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Terraform state をS3に保存（本番環境では推奨）
  # backend "s3" {
  #   bucket = "your-terraform-state-bucket"
  #   key    = "github-analyzer/terraform.tfstate"
  #   region = "ap-northeast-1"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "github-analyzer"
      ManagedBy   = "terraform"
      Region      = var.aws_region
      SingleRegion = "true"
      CostOptimized = "true"
    }
  }
}

# データソース
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# Local values
locals {
  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
  
  # 共通のタグ
  common_tags = {
    Environment = var.environment
    Project     = "github-analyzer"
    ManagedBy   = "terraform"
    Region      = var.aws_region
    SingleRegion = "true"
    Architecture = "serverless-optimized"
    CostOptimized = "true"
  }

  # 命名規則
  name_prefix = "${var.project_name}-${var.environment}"
}

# DynamoDB テーブル（Single Region最適化）
resource "aws_dynamodb_table" "github_analyzer_data" {
  name         = "${local.name_prefix}-data"
  billing_mode = "ON_DEMAND"  # 予測不能なワークロードに最適
  hash_key     = "PK"
  range_key    = "SK"
  
  # Single Region設定を明示的に指定
  table_class = "STANDARD"  # Global TablesではなくStandardテーブル

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # TTL設定（180日コスト削減）
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # バックアップ設定（デフォルトで無効でコスト削減）
  point_in_time_recovery {
    enabled = var.enable_dynamodb_backup
  }
  
  # ストリーム設定を明示的に無効化（コスト削減）
  stream_enabled = false

  tags = merge(local.common_tags, {
    "SingleRegion" = "true"
    "Optimized"    = "true"
    "DataCompression" = "enabled"
  })
}

# Lambda 実行ロール
resource "aws_iam_role" "lambda_execution_role" {
  name = "${local.name_prefix}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = local.common_tags
}

# Lambda IAM ポリシー
resource "aws_iam_role_policy" "lambda_policy" {
  name = "${local.name_prefix}-lambda-policy"
  role = aws_iam_role.lambda_execution_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
          "s3:GetObject"
        ]
        Resource = "${aws_s3_bucket.logs.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.github_analyzer_data.arn,
          "${aws_dynamodb_table.github_analyzer_data.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters"
        ]
        Resource = [
          "arn:aws:ssm:${local.region}:${local.account_id}:parameter/${var.project_name}/*"
        ]
      }
    ]
  })
}

# S3ログバケット
resource "aws_s3_bucket" "logs" {
  bucket = "${local.name_prefix}-logs"
  
  tags = local.common_tags
}

# S3バケットのバージョニング設定
resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id
  
  versioning_configuration {
    status = "Disabled"
  }
}

# S3バケットのライフサイクル設定（30日後に削除）
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "delete-old-logs"
    status = "Enabled"

    expiration {
      days = 30
    }
  }
}

# S3バケットのパブリックアクセスブロック
resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lambda 関数
resource "aws_lambda_function" "github_analyzer" {
  function_name = "${local.name_prefix}-handler"
  role          = aws_iam_role.lambda_execution_role.arn
  
  # デプロイ時にzipファイルから更新
  filename         = "../lambda/deployment.zip"
  source_code_hash = filebase64sha256("../lambda/deployment.zip")
  
  handler = "index.handler"
  runtime = "nodejs18.x"
  architectures = ["arm64"]  # ARMプロセッサでコスト削減
  timeout = 30  # 30秒に短縮
  
  memory_size = 384  # 384MBに削減

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.github_analyzer_data.name
      AWS_REGION          = local.region
      ENVIRONMENT         = var.environment
      GITHUB_TOKEN_PARAM  = aws_ssm_parameter.github_token.name
      LOG_BUCKET_NAME     = aws_s3_bucket.logs.id
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda_policy,
    aws_s3_bucket.logs
  ]

  tags = local.common_tags
}

# Lambda Function URL
resource "aws_lambda_function_url" "github_analyzer_url" {
  function_name      = aws_lambda_function.github_analyzer.function_name
  authorization_type = var.enable_cognito_auth ? "AWS_IAM" : "NONE"
  
  cors {
    allow_credentials = true
    allow_origins     = var.allowed_origins
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers     = ["content-type", "x-amz-date", "authorization", "x-api-key", "x-amz-security-token"]
    expose_headers    = ["x-amz-request-id", "x-cache"]
    max_age          = 300
  }
}


# Lambda Function URLのパブリックアクセス許可（認証なしの場合）
resource "aws_lambda_permission" "function_url" {
  count = var.enable_cognito_auth ? 0 : 1
  
  statement_id  = "AllowPublicAccess"
  action        = "lambda:InvokeFunctionUrl"
  function_name = aws_lambda_function.github_analyzer.function_name
  principal     = "*"
  
  function_url_auth_type = "NONE"
}

# Systems Manager Parameter Store - GitHub Token
resource "aws_ssm_parameter" "github_token" {
  name  = "/${var.project_name}/${var.environment}/github-token"
  type  = "SecureString"
  value = var.github_token

  description = "GitHub personal access token for API access"

  tags = local.common_tags
}

# 組織名パラメータ（必要に応じて）
resource "aws_ssm_parameter" "github_org" {
  name  = "/${var.project_name}/${var.environment}/github-org"
  type  = "String"
  value = var.github_organization

  description = "GitHub organization name"

  tags = local.common_tags
}