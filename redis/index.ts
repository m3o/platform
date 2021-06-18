import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import { project, vpc, cluster } from "../cluster";
import * as k8s from "@pulumi/kubernetes";
import {bucket, postgres} from "../postgres";


const conf = new pulumi.Config("digitalocean");

export const redis = new ocean.DatabaseCluster("api-redis-cluster",
    {
        engine: "redis",
        nodeCount: 2,
        region: conf.require("region") as ocean.Region,
        size: "m-2vcpu-16gb" as ocean.DatabaseSlug,
        version: "6",
        privateNetworkUuid: vpc.id,
    },
    {
        parent: project,
      dependsOn: cluster
    }
);

export const redisfw = new ocean.DatabaseFirewall("api-redis-fw",
    {
        clusterId: redis.id,
        rules: [
            {
                type: "k8s",
                value: cluster.id,
            }
        ]
    },
  {
    dependsOn: redis
  }
)

export const pr = new ocean.ProjectResources("pr-redis", {
  project: project.id,
  resources: [redis.clusterUrn]
})

export const backupCron = new k8s.batch.v2alpha1.CronJob("redisBackup", {
  spec : {
    schedule: "0 */2 * * *",
    jobTemplate: {
      spec: {
        template:{
          spec: {
            containers: [
              {
                name: "redis-backup",
                image: "ghcr.io/m3o/redis-backup",
                imagePullPolicy: "Always",
                env: [
                  {
                    name: "MICRO_S3_BACKUP_BUCKET",
                    value: bucket.name
                  },
                  {
                    name: "MICRO_S3_ACCESS_KEY",
                    value: conf.require("s3_access_key")
                  },
                  {
                    name: "MICRO_S3_SECRET_KEY",
                    value: conf.require("s3_secret_key")
                  },
                  {
                    name: "MICRO_REDIS_URI",
                    value: redis.uri
                  },
                  {
                    name: "RUMP_READ_TIMEOUT",
                    value: "5m"
                  }
                ]
              }
            ],
          }
        }
      }
    }
  }
})
