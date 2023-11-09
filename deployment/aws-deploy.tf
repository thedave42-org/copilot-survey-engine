provider "aws" {
  region = "us-west-1"
}

resource "aws_vpc" "copilot-survey-engine-vpc" {
  cidr_block = "10.0.0.0/16"
  tags = {
    Name = "copilot-survey-engine-vpc"
  }
}

resource "aws_subnet" "copilot-survey-engine-public-subnet" {
  vpc_id     = aws_vpc.copilot-survey-engine-vpc.id
  cidr_block = "10.0.1.0/24"
  tags = {
    Name = "copilot-survey-engine-public-subnet"
  }
}

resource "aws_subnet" "copilot-survey-engine-private-subnet" {
  vpc_id     = aws_vpc.copilot-survey-engine-vpc.id
  cidr_block = "10.0.2.0/24"
  tags = {
    Name = "copilot-survey-engine-private-subnet"
  }
}

resource "aws_security_group" "copilot-survey-engine-docker-sg" {
  name_prefix = "copilot-survey-engine-docker-sg-"
  vpc_id      = aws_vpc.copilot-survey-engine-vpc.id

  ingress {
    from_port   = 80
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "copilot-survey-engine-postgres-sg" {
  name_prefix = "copilot-survey-engine-postgres-sg-"
  vpc_id      = aws_vpc.copilot-survey-engine-vpc.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    security_groups = [aws_security_group.copilot-survey-engine-docker-sg.id]
  }
}

resource "aws_db_subnet_group" "copilot-survey-engine-db-subnet-group" {
  name       = "copilot-survey-engine-db-subnet-group"
  subnet_ids = [aws_subnet.copilot-survey-engine-private-subnet.id]
}

resource "aws_db_instance" "copilot-survey-engine-db" {
  identifier             = "copilot-survey-engine-db"
  engine                 = "postgres"
  engine_version         = "12.5"
  instance_class         = "db.t2.micro"
  allocated_storage      = 10
  storage_type           = "gp2"
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.copilot-survey-engine-db-subnet-group.name
  vpc_security_group_ids = [aws_security_group.copilot-survey-engine-postgres-sg.id]
  tags = {
    Name = "copilot-survey-engine-db"
  }
}

resource "aws_ecs_cluster" "copilot-survey-engine-cluster" {
  name = "copilot-survey-engine-cluster"
}

resource "aws_ecs_task_definition" "copilot-survey-engine-task" {
  family                   = "copilot-survey-engine-task"
  container_definitions    = <<DEFINITION
[
  {
    "name": "copilot-survey-engine-container",
    "image": "ghcr.io/thedave42-org/copilot-survey-engine-container:latest",
    "portMappings": [
      {
        "containerPort": 80,
        "hostPort": 80
      },
      {
        "containerPort": 443,
        "hostPort": 443
      }
    ]
  }
]
DEFINITION
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  network_mode             = "awsvpc"
}

resource "aws_ecs_service" "copilot-survey-engine-service" {
  name            = "copilot-survey-engine-service"
  cluster         = aws_ecs_cluster.copilot-survey-engine-cluster.id
  task_definition = aws_ecs_task_definition.copilot-survey-engine-task.arn
  desired_count   = 1

  network_configuration {
    subnets          = [aws_subnet.copilot-survey-engine-public-subnet.id]
    security_groups  = [aws_security_group.copilot-survey-engine-docker-sg.id]
    assign_public_ip = true
  }
}