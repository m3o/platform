import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import { project, vpc, cluster } from "../cluster";


const conf = new pulumi.Config("digitalocean");

export const redis = new ocean.DatabaseCluster("api-redis-cluster",
    {
        engine: "redis",
        nodeCount: 2,
        region: conf.require("region") as ocean.Region,
        size: "db-s-1vcpu-2gb",
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
