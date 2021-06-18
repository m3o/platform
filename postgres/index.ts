import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import * as k8s from "@pulumi/kubernetes";
import { project, vpc, cluster } from "../cluster";
import * as gcp from "@pulumi/gcp";


const conf = new pulumi.Config("digitalocean");
const gcpConf = new pulumi.Config("gcp");

export const postgres = new ocean.DatabaseCluster("postgres-cluster",
    {
        engine: "pg",
        nodeCount: 2,
        region: conf.require("region") as ocean.Region,
        size: "db-s-4vcpu-8gb" as ocean.DatabaseSlug,
        version: "13",
        privateNetworkUuid: vpc.id,
    },
    {
        parent: project,
      dependsOn: cluster
    }
);

export const postgresfw = new ocean.DatabaseFirewall("postgres-fw",
    {
        clusterId: postgres.id,
        rules: [
            {
                type: "k8s",
                value: cluster.id,
            }
        ]
    },
  {
    dependsOn: postgres
  }
)

export const pr = new ocean.ProjectResources("pr-postgres", {
  project: project.id,
  resources: [postgres.clusterUrn]
})

export const bucket = new gcp.storage.Bucket("postgres-bucket", {
  location: conf.require("region"),
  project: conf.require("project"),
});

export const backupCron = new k8s.batch.v2alpha1.CronJob("postgresBackup", {
  spec : {
    schedule: "0 */2 * * *",
    jobTemplate: {
      spec: {
        template:{
          spec: {
            containers: [
              {
                name: "postgres-backup",
                image: "ghcr.io/m3o/postgres-backup",
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
                    name: "MICRO_POSTGRES_HOST",
                    value: postgres.host
                  },
                  {
                    name: "MICRO_POSTGRES_POST",
                    value: String(postgres.port)
                  },
                  {
                    name: "MICRO_POSTGRES_USER",
                    value: postgres.user
                  },
                  {
                    name: "MICRO_POSTGRES_PASS",
                    value: postgres.password
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
