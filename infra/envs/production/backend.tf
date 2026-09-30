terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.0" }
  }

  # State bucket is created by scripts/bootstrap-aws.sh. Change the bucket name
  # here if you set STATE_BUCKET to something other than the default.
  backend "s3" {
    bucket       = "charity-site-tfstate"
    key          = "production/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true # native S3 locking (Terraform >= 1.10), no DynamoDB
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "charity-site"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}

# CloudFront only reads certificates from us-east-1: the newsletter's click-tracking domain needs
# one there (TASK-466, infra/modules/app/ses.tf). Nothing else runs in this region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "charity-site"
      Environment = "production"
      ManagedBy   = "terraform"
    }
  }
}
