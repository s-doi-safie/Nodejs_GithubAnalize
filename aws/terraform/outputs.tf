# API Gateway
output "api_gateway_url" {
  description = "API Gateway のURL"
  value       = aws_apigatewayv2_stage.default.invoke_url
}

output "api_gateway_id" {
  description = "API Gateway のID"
  value       = aws_apigatewayv2_api.github_analyzer_api.id
}

# Lambda
output "lambda_function_name" {
  description = "Lambda関数名"
  value       = aws_lambda_function.github_analyzer.function_name
}

output "lambda_function_arn" {
  description = "Lambda関数のARN"
  value       = aws_lambda_function.github_analyzer.arn
}

# DynamoDB
output "dynamodb_table_name" {
  description = "DynamoDB テーブル名"
  value       = aws_dynamodb_table.github_analyzer_data.name
}

output "dynamodb_table_arn" {
  description = "DynamoDB テーブルのARN"
  value       = aws_dynamodb_table.github_analyzer_data.arn
}

# Cognito（有効な場合のみ）
output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = var.enable_cognito_auth ? aws_cognito_user_pool.github_analyzer[0].id : null
}

output "cognito_user_pool_client_id" {
  description = "Cognito User Pool Client ID"
  value       = var.enable_cognito_auth ? aws_cognito_user_pool_client.github_analyzer_client[0].id : null
}

output "cognito_domain" {
  description = "Cognito認証ドメイン"
  value       = var.enable_cognito_auth ? aws_cognito_user_pool_domain.github_analyzer_domain[0].domain : null
}

output "cognito_hosted_ui_url" {
  description = "Cognito Hosted UI URL"
  value = var.enable_cognito_auth ? format(
    "https://%s.auth.%s.amazoncognito.com/login?client_id=%s&response_type=code&scope=openid+email+profile&redirect_uri=%s",
    aws_cognito_user_pool_domain.github_analyzer_domain[0].domain,
    local.region,
    aws_cognito_user_pool_client.github_analyzer_client[0].id,
    urlencode(var.cognito_callback_urls[0])
  ) : null
}

# IAM
output "lambda_execution_role_arn" {
  description = "Lambda実行ロールのARN"
  value       = aws_iam_role.lambda_execution_role.arn
}

# CloudWatch
output "lambda_log_group_name" {
  description = "Lambda CloudWatch Logsグループ名"
  value       = aws_cloudwatch_log_group.lambda_logs.name
}

output "api_gateway_log_group_name" {
  description = "API Gateway CloudWatch Logsグループ名"
  value       = aws_cloudwatch_log_group.api_gateway_logs.name
}

# Systems Manager Parameter Store
output "github_token_parameter_name" {
  description = "GitHub Token パラメータ名"
  value       = aws_ssm_parameter.github_token.name
  sensitive   = true
}

output "github_org_parameter_name" {
  description = "GitHub組織パラメータ名"
  value       = aws_ssm_parameter.github_org.name
}

# デプロイメント情報
output "deployment_info" {
  description = "デプロイメント情報"
  value = {
    environment           = var.environment
    region               = local.region
    account_id           = local.account_id
    project_name         = var.project_name
    terraform_workspace  = terraform.workspace
    deployed_at          = timestamp()
  }
}

# 設定情報（デバッグ用）
output "configuration_summary" {
  description = "設定サマリー"
  value = {
    cognito_auth_enabled     = var.enable_cognito_auth
    email_domain_restriction = var.email_domain_restriction != "" ? "enabled" : "disabled"
    dynamodb_backup_enabled  = var.enable_dynamodb_backup
    lambda_timeout          = var.lambda_timeout
    lambda_memory_size      = var.lambda_memory_size
    log_retention_days      = var.log_retention_days
  }
}

# フロントエンド設定用の環境変数
output "frontend_environment_variables" {
  description = "フロントエンド用の環境変数"
  value = {
    REACT_APP_API_BASE_URL     = aws_apigatewayv2_stage.default.invoke_url
    REACT_APP_AWS_REGION       = local.region
    REACT_APP_COGNITO_USER_POOL_ID = var.enable_cognito_auth ? aws_cognito_user_pool.github_analyzer[0].id : ""
    REACT_APP_COGNITO_CLIENT_ID    = var.enable_cognito_auth ? aws_cognito_user_pool_client.github_analyzer_client[0].id : ""
    REACT_APP_COGNITO_DOMAIN       = var.enable_cognito_auth ? "${aws_cognito_user_pool_domain.github_analyzer_domain[0].domain}.auth.${local.region}.amazoncognito.com" : ""
    REACT_APP_ENVIRONMENT          = var.environment
  }
}

# GitHub Actions用の出力
output "github_actions_secrets" {
  description = "GitHub Actions用のシークレット情報"
  value = {
    AWS_LAMBDA_FUNCTION_NAME = aws_lambda_function.github_analyzer.function_name
    AWS_REGION              = local.region
    DYNAMODB_TABLE_NAME     = aws_dynamodb_table.github_analyzer_data.name
  }
  sensitive = true
}

# 接続確認用のcurl例
output "api_test_commands" {
  description = "API動作確認用のcurlコマンド例"
  value = {
    health_check = "curl -X GET ${aws_apigatewayv2_stage.default.invoke_url}/api/health"
    review_data  = "curl -X GET ${aws_apigatewayv2_stage.default.invoke_url}/api/review-data"
    teams_data   = "curl -X GET ${aws_apigatewayv2_stage.default.invoke_url}/api/teams"
  }
}

# カスタムドメイン情報（設定されている場合）
output "custom_domain_info" {
  description = "カスタムドメイン情報"
  value = var.custom_domain_name != "" ? {
    domain_name     = var.custom_domain_name
    certificate_arn = var.certificate_arn
  } : null
}

# コスト見積もり情報
output "estimated_monthly_costs" {
  description = "月額コスト見積もり（参考値）"
  value = {
    lambda_requests_per_month = "1,000,000リクエスト想定: 約$0.20"
    dynamodb_on_demand       = "読み書き100万リクエスト想定: 約$1.25"
    api_gateway             = "100万APIコール想定: 約$3.50"
    cloudwatch_logs         = "10GB/月想定: 約$5.00"
    total_estimated         = "約$10-15/月（使用量による）"
    note                   = "実際のコストは使用量により変動します"
  }
}