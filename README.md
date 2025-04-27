# AWS Resource Deletion Tool (Safe Mode)

This Node.js script provides a **safe and interactive** way to delete AWS
resources such as:

- S3 Buckets
- CloudFront Distributions
- ACM Certificates
- Route53 Records
- Route53 Hosted Zones

It uses **inquirer** for prompts and **AWS SDK v3** for resource management.

---

## 🛠 Prerequisites

- Node.js (v14 or higher recommended)
- AWS account credentials with sufficient permissions
- Installed packages (`package.json` is already provided)

Install dependencies with:

```bash
npm install
```

Run script with:

```bash
node script.js
```
