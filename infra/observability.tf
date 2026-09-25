resource "aws_cloudwatch_log_group" "api" {
  name = "/${var.name}/api"

  # Logs are the first place a production problem is visible; two weeks is
  # enough to investigate one and short enough to stay inside the free tier.
  retention_in_days = 14
}

# The container is configured to restart on failure, so a crash loop is
# invisible unless something watches for it.
resource "aws_cloudwatch_log_metric_filter" "api_errors" {
  name           = "${var.name}-api-errors"
  log_group_name = aws_cloudwatch_log_group.api.name
  # pino writes level 50 for error and 60 for fatal.
  pattern = "{ $.level >= 50 }"

  metric_transformation {
    name      = "ApiErrors"
    namespace = var.name
    value     = "1"
    unit      = "Count"
    # Without this the metric reports no data rather than zero when nothing is
    # wrong, and an alarm on missing data is not the same as an alarm on health.
    default_value = "0"
  }
}

# Where every alarm below is sent.
resource "aws_sns_topic" "alarms" {
  name = "${var.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "api_errors" {
  alarm_name          = "${var.name}-api-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  threshold           = 10
  period              = 300
  statistic           = "Sum"
  metric_name         = aws_cloudwatch_log_metric_filter.api_errors.metric_transformation[0].name
  namespace           = var.name
  alarm_description   = "More than ten errors logged in five minutes"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_metric_alarm" "database_storage" {
  alarm_name          = "${var.name}-database-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  threshold           = 2147483648 # 2 GiB
  period              = 300
  statistic           = "Average"
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  alarm_description   = "Less than 2GiB of database storage left"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  ok_actions          = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.identifier
  }
}
