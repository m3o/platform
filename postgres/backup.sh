#!/bin/bash
set -e
set -x
# back up to local file
now=$(date +%s)
# upload to s3
bucket=$MICRO_S3_BACKUP_BUCKET
destination="s3://$bucket/postgres/"
accessKey=$MICRO_S3_ACCESS_KEY
secretKey=$MICRO_S3_SECRET_KEY

host=$MICRO_POSTGRES_HOST
port=$MICRO_POSTGRES_PORT
user=$MICRO_POSTGRES_USER
pass=$MICRO_POSTGRES_PASS

dbs=( $(PGPASSWORD=$pass psql -h $host -p $port -U $user defaultdb -c "select datname from pg_database" --csv -t ) )

for i in "${dbs[@]}"
do
  if [[ $i == '_dodb' || $i == 'template1' || $i == 'template0' ]]; then
    continue
  fi
  fileName=$i-backup.sql
  PGPASSWORD=$pass pg_dump -h $host -p $port -U $user -f "$fileName" "$i"
done

tar -czf $now.tar.gz *.sql
s3cmd put "$now.tar.gz" "$destination" --access_key "$accessKey" --secret_key "$secretKey" --host "storage.googleapis.com" --host-bucket "$bucket"
