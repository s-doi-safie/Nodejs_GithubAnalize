# Cognito User Pool
resource "aws_cognito_user_pool" "github_analyzer" {
  count = var.enable_cognito_auth ? 1 : 0
  
  name = "${local.name_prefix}-user-pool"

  # ユーザー名の設定
  alias_attributes = ["email"]
  
  # パスワードポリシー
  password_policy {
    minimum_length                   = 8
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # ユーザー検証設定
  auto_verified_attributes = ["email"]

  # メール設定
  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  # アカウント回復設定
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # ユーザープール削除保護
  deletion_protection = var.environment == "production" ? "ACTIVE" : "INACTIVE"

  # メールドメイン制限（Lambda トリガーで実装）
  lambda_config {
    pre_sign_up = var.email_domain_restriction != "" ? aws_lambda_function.email_domain_validator[0].arn : null
  }

  tags = local.common_tags
}

# User Pool Client
resource "aws_cognito_user_pool_client" "github_analyzer_client" {
  count = var.enable_cognito_auth ? 1 : 0
  
  name         = "${local.name_prefix}-client"
  user_pool_id = aws_cognito_user_pool.github_analyzer[0].id

  # OAuth設定
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  
  callback_urls = var.cognito_callback_urls
  logout_urls   = var.cognito_logout_urls

  # セッション設定
  access_token_validity  = 1  # 1時間
  id_token_validity      = 1  # 1時間
  refresh_token_validity = 30 # 30日

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  # セキュリティ設定
  generate_secret = false # SPAなのでclient_secretは使用しない
  
  explicit_auth_flows = [
    "ALLOW_CUSTOM_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  # PKCE設定
  supported_identity_providers = ["COGNITO"]
}

# User Pool Domain
resource "aws_cognito_user_pool_domain" "github_analyzer_domain" {
  count = var.enable_cognito_auth ? 1 : 0
  
  domain       = "${local.name_prefix}-auth"
  user_pool_id = aws_cognito_user_pool.github_analyzer[0].id
}

# API Gateway Cognito Authorizer
resource "aws_apigatewayv2_authorizer" "cognito_authorizer" {
  count = var.enable_cognito_auth ? 1 : 0
  
  api_id           = aws_apigatewayv2_api.github_analyzer_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "${local.name_prefix}-authorizer"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.github_analyzer_client[0].id]
    issuer   = "https://cognito-idp.${local.region}.amazonaws.com/${aws_cognito_user_pool.github_analyzer[0].id}"
  }
}

# メールドメイン制限用Lambda関数（条件付き作成）
resource "aws_lambda_function" "email_domain_validator" {
  count = var.enable_cognito_auth && var.email_domain_restriction != "" ? 1 : 0
  
  function_name = "${local.name_prefix}-email-validator"
  role          = aws_iam_role.email_validator_role[0].arn
  
  handler = "index.handler"
  runtime = "nodejs18.x"
  timeout = 10

  zip_file = templatefile("${path.module}/lambda_functions/email_validator.js", {
    allowed_domain = var.email_domain_restriction
  })

  environment {
    variables = {
      ALLOWED_DOMAIN = var.email_domain_restriction
    }
  }

  tags = local.common_tags
}

# メールドメイン制限用Lambda IAMロール
resource "aws_iam_role" "email_validator_role" {
  count = var.enable_cognito_auth && var.email_domain_restriction != "" ? 1 : 0
  
  name = "${local.name_prefix}-email-validator-role"

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

# メールドメイン制限用Lambda IAMポリシー
resource "aws_iam_role_policy_attachment" "email_validator_basic" {
  count = var.enable_cognito_auth && var.email_domain_restriction != "" ? 1 : 0
  
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.email_validator_role[0].name
}

# Lambda に Cognito からの実行許可を付与
resource "aws_lambda_permission" "cognito_lambda" {
  count = var.enable_cognito_auth && var.email_domain_restriction != "" ? 1 : 0
  
  statement_id  = "AllowExecutionFromCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.email_domain_validator[0].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.github_analyzer[0].arn
}

# CloudWatch Logs グループ（メール検証Lambda用）
resource "aws_cloudwatch_log_group" "email_validator_logs" {
  count = var.enable_cognito_auth && var.email_domain_restriction != "" ? 1 : 0
  
  name              = "/aws/lambda/${local.name_prefix}-email-validator"
  retention_in_days = var.log_retention_days

  tags = local.common_tags
}