terraform {
  required_providers {
    postgresql = {
      source = "cyrilgdn/postgresql"
      version = "1.21.1-beta.1"
    }
  }
}

provider "postgresql" {
  host            = "localhost"
  port            = 5432
  username        = "postgres"
  password        = "postgres"
  sslmode         = "disable"
  connect_timeout = 15
}

resource "postgresql_database" "copilot_survey_engine_data" {
  name  = "copilot-survey-engine-data"
  owner = "postgres"
}