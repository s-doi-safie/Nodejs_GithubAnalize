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
  }

  # 命名規則
  name_prefix = "${var.project_name}-${var.environment}"
}

# DynamoDB テーブル
resource "aws_dynamodb_table" "github_analyzer_data" {
  name         = "${local.name_prefix}-data"
  billing_mode = "ON_DEMAND"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # TTL設定
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  # バックアップ設定
  point_in_time_recovery {
    enabled = var.enable_dynamodb_backup
  }

  tags = local.common_tags
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
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:*"
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

# CloudWatch Logs グループ
resource "aws_cloudwatch_log_group" "lambda_logs" {
  name              = "/aws/lambda/${local.name_prefix}-handler"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
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
  timeout = var.lambda_timeout
  
  memory_size = var.lambda_memory_size

  environment {
    variables = {
      DYNAMODB_TABLE_NAME = aws_dynamodb_table.github_analyzer_data.name
      AWS_REGION          = local.region
      ENVIRONMENT         = var.environment
      GITHUB_TOKEN_PARAM  = aws_ssm_parameter.github_token.name
    }
  }

  depends_on = [
    aws_iam_role_policy.lambda_policy,
    aws_cloudwatch_log_group.lambda_logs
  ]

  tags = local.common_tags
}

# API Gateway
resource "aws_apigatewayv2_api" "github_analyzer_api" {
  name          = "${local.name_prefix}-api"
  protocol_type = "HTTP"
  
  cors_configuration {
    allow_origins     = var.allowed_origins
    allow_methods     = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers     = ["content-type", "x-amz-date", "authorization", "x-api-key", "x-amz-security-token"]
    expose_headers    = ["x-amz-request-id"]
    max_age          = 300
    allow_credentials = true
  }

  tags = local.common_tags
}

# API Gateway Lambda 統合
resource "aws_apigatewayv2_integration" "lambda_integration" {
  api_id = aws_apigatewayv2_api.github_analyzer_api.id

  integration_uri    = aws_lambda_function.github_analyzer.invoke_arn
  integration_type   = "AWS_PROXY"
  integration_method = "POST"

  payload_format_version = "2.0"
}

# API Gateway ルート（すべてをLambdaに送信）
resource "aws_apigatewayv2_route" "default_route" {
  api_id = aws_apigatewayv2_api.github_analyzer_api.id

  route_key = "ANY /{proxy+}"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"

  authorization_type = var.enable_cognito_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_cognito_auth ? aws_apigatewayv2_authorizer.cognito_authorizer[0].id : null
}

# ルートパス用のルート
resource "aws_apigatewayv2_route" "root_route" {
  api_id = aws_apigatewayv2_api.github_analyzer_api.id

  route_key = "ANY /"
  target    = "integrations/${aws_apigatewayv2_integration.lambda_integration.id}"

  authorization_type = var.enable_cognito_auth ? "JWT" : "NONE"
  authorizer_id      = var.enable_cognito_auth ? aws_apigatewayv2_authorizer.cognito_authorizer[0].id : null
}

# API Gateway デプロイメントステージ
resource "aws_apigatewayv2_stage" "default" {
  api_id = aws_apigatewayv2_api.github_analyzer_api.id

  name        = var.environment
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  tags = local.common_tags
}

# API Gateway CloudWatch Logs
resource "aws_cloudwatch_log_group" "api_gateway_logs" {
  name              = "/aws/apigateway/${local.name_prefix}"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}

# Lambda に API Gateway からの実行許可を付与
resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowExecutionFromAPIGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.github_analyzer.function_name
  principal     = "apigateway.amazonaws.com"

  source_arn = "${aws_apigatewayv2_api.github_analyzer_api.execution_arn}/*/*"
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