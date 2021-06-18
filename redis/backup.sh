#!/bin/bash
set -e
set -x
# back up to local file
now=$(date +%s)
# upload to s3
bucket=$MICRO_S3_BACKUP_BUCKET
destination="s3://$bucket/redis/"
accessKey=$MICRO_S3_ACCESS_KEY
secretKey=$MICRO_S3_SECRET_KEY

redisURI=$MICRO_REDIS_URI

./rump -from "$redisURI" -to dump.rump

tar -czf $now.tar.gz dump.rump
s3cmd put "$now.tar.gz" "$destination" --access_key "$accessKey" --secret_key "$secretKey" --host "storage.googleapis.com" --host-bucket "$bucket"
