const inquirer = require('inquirer');
const {
  CloudFrontClient,
  GetDistributionCommand,
  UpdateDistributionCommand,
  DeleteDistributionCommand,
} = require('@aws-sdk/client-cloudfront');
const { ACMClient, DeleteCertificateCommand } = require('@aws-sdk/client-acm');
const {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
  DeleteHostedZoneCommand,
} = require('@aws-sdk/client-route-53');

const {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteBucketCommand,
} = require('@aws-sdk/client-s3');

// Utility logger
const log = msg => console.log(`👉 ${msg}`);

// Prompt confirmation before deletion
async function confirm(prompt) {
  const { confirmed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: prompt,
      default: false,
    },
  ]);
  return confirmed;
}

// Delete CloudFront Distribution
async function deleteCloudFront(distributionId, client) {
  const { Distribution, ETag } = await client.send(
    new GetDistributionCommand({ Id: distributionId })
  );

  if (Distribution?.DistributionConfig?.Enabled) {
    log(`Disabling CloudFront Distribution ${distributionId}...`);
    await client.send(
      new UpdateDistributionCommand({
        Id: distributionId,
        IfMatch: ETag,
        DistributionConfig: {
          ...Distribution.DistributionConfig,
          Enabled: false,
        },
      })
    );

    log('Waiting 60 seconds for CloudFront to disable...');
    await new Promise(res => setTimeout(res, 60000));
  }

  if (await confirm(`Delete CloudFront Distribution: ${distributionId}?`)) {
    await client.send(
      new DeleteDistributionCommand({ Id: distributionId, IfMatch: ETag })
    );
    log(`✅ CloudFront Distribution ${distributionId} deleted.`);
  }
}

// Delete ACM Certificate
async function deleteCertificate(certArn, client) {
  if (await confirm(`Delete ACM Certificate: ${certArn}?`)) {
    await client.send(
      new DeleteCertificateCommand({ CertificateArn: certArn })
    );
    log(`✅ ACM Certificate ${certArn} deleted.`);
  }
}

// Delete Route53 Record
async function deleteRoute53Record(client, hostedZoneId, recordName, type) {
  const { ResourceRecordSets } = await client.send(
    new ListResourceRecordSetsCommand({ HostedZoneId: hostedZoneId })
  );

  const record = ResourceRecordSets.find(
    r => r.Name === `${recordName}.` && r.Type === type
  );

  if (!record) {
    log(`⚠️ No ${type} record found for ${recordName}`);
    return;
  }

  if (await confirm(`Delete ${type} record for ${recordName}?`)) {
    await client.send(
      new ChangeResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        ChangeBatch: {
          Changes: [
            {
              Action: 'DELETE',
              ResourceRecordSet: record,
            },
          ],
        },
      })
    );
    log(`✅ ${type} record for ${recordName} deleted.`);
  }
}

// delete s3 bucket
async function deleteS3Bucket(bucketName, s3Client) {
  log(`Checking S3 Bucket: ${bucketName}`);

  if (!(await confirm(`Delete all contents and the bucket "${bucketName}"?`)))
    return;

  let isTruncated = true;
  let continuationToken;

  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } =
      await s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          ContinuationToken: continuationToken,
        })
      );

    if (Contents && Contents.length > 0) {
      const deleteParams = {
        Bucket: bucketName,
        Delete: {
          Objects: Contents.map(({ Key }) => ({ Key })),
          Quiet: true,
        },
      };

      await s3Client.send(new DeleteObjectsCommand(deleteParams));
      log(`🧹 Deleted ${Contents.length} objects from ${bucketName}`);
    }

    isTruncated = IsTruncated;
    continuationToken = NextContinuationToken;
  }

  await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
  log(`✅ S3 bucket "${bucketName}" deleted.`);
}

// delete hosted zone
async function deleteHostedZone(route53Client, hostedZoneId) {
  const { ResourceRecordSets } = await route53Client.send(
    new ListResourceRecordSetsCommand({ HostedZoneId: hostedZoneId })
  );

  const recordsToDelete = ResourceRecordSets.filter(
    r => !['NS', 'SOA'].includes(r.Type)
  );

  for (const record of recordsToDelete) {
    const shouldDelete = await confirm(
      `Delete ${record.Type} record for ${record.Name}?`
    );
    if (shouldDelete) {
      await route53Client.send(
        new ChangeResourceRecordSetsCommand({
          HostedZoneId: hostedZoneId,
          ChangeBatch: {
            Changes: [
              {
                Action: 'DELETE',
                ResourceRecordSet: record,
              },
            ],
          },
        })
      );
      log(`✅ Deleted ${record.Type} record: ${record.Name}`);
    }
  }

  const finalConfirm = await confirm(
    `Delete the hosted zone "${hostedZoneId}" now?`
  );
  if (finalConfirm) {
    await route53Client.send(new DeleteHostedZoneCommand({ Id: hostedZoneId }));
    log(`✅ Hosted zone "${hostedZoneId}" deleted.`);
  }
}

// Main logic
async function main() {
  console.clear();
  console.log('🔐 AWS Resource Deletion Tool (Safe Mode)');

  const {
    awsAccessKeyId,
    awsSecretAccessKey,
    region,
    distributionId,
    certificateArn,
    hostedZoneId,
    domainName,
    s3BucketName,
  } = await inquirer.prompt([
    {
      type: 'input',
      name: 'awsAccessKeyId',
      message: 'Enter AWS Access Key ID:',
      validate: input => (input ? true : 'Access Key is required.'),
    },
    {
      type: 'input',
      name: 'awsSecretAccessKey',
      message: 'Enter AWS Secret Access Key:',
      validate: input => (input ? true : 'Secret Key is required.'),
    },
    {
      type: 'input',
      name: 'region',
      message: 'Enter AWS Region (default: us-east-1):',
      default: 'us-east-1',
    },
    {
      type: 'input',
      name: 's3BucketName',
      message: 'Enter S3 Bucket name (leave blank to skip):',
    },
    {
      type: 'input',
      name: 'distributionId',
      message: 'Enter CloudFront Distribution ID (leave blank to skip):',
    },
    {
      type: 'input',
      name: 'certificateArn',
      message: 'Enter ACM Certificate ARN (leave blank to skip):',
    },
    {
      type: 'input',
      name: 'hostedZoneId',
      message: 'Enter Hosted Zone ID (leave blank to skip):',
    },
    {
      type: 'input',
      name: 'domainName',
      message: 'Enter Domain Name (e.g., example.com) (leave blank to skip):',
    },
  ]);

  const s3Client = new S3Client({
    region,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  });

  const cloudfrontClient = new CloudFrontClient({
    region,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  });

  const acmClient = new ACMClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  });

  const route53Client = new Route53Client({
    region,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey,
    },
  });

  try {
    if (s3BucketName) {
      await deleteS3Bucket(s3BucketName, s3Client);
    }

    if (hostedZoneId) {
      await deleteHostedZone(route53Client, hostedZoneId);
    }

    if (distributionId) {
      await deleteCloudFront(distributionId, cloudfrontClient);
    }

    if (certificateArn) {
      await deleteCertificate(certificateArn, acmClient);
    }

    if (hostedZoneId && domainName) {
      if (distributionId) {
        await deleteRoute53Record(route53Client, hostedZoneId, domainName, 'A');
      }

      if (certificateArn) {
        await deleteRoute53Record(
          route53Client,
          hostedZoneId,
          `_acme-challenge.${domainName}`,
          'CNAME'
        );
      }
    }

    log('✅ All selected operations completed.');
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();
