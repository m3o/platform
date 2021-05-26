import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import { project, vpc, cluster } from "../cluster";


const conf = new pulumi.Config("digitalocean");

export const postgres = new ocean.DatabaseCluster("postgres-cluster",
    {
        engine: "pg",
        nodeCount: 2,
        region: conf.require("region") as ocean.Region,
        size: "db-g-2vcpu-8gb" as ocean.DatabaseSlug,
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
