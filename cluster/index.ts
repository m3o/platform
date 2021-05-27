import * as pulumi from "@pulumi/pulumi";
import * as ocean from "@pulumi/digitalocean";
import * as k8s from "@pulumi/kubernetes";

const conf = new pulumi.Config("digitalocean");

export const project = new ocean.Project("project", {
  environment: conf.require("env"),
  name: conf.require("name"),
});

export const vpc = new ocean.Vpc("vpc", {
  region: conf.require("region"),
},{ 
  parent: project,
});

export const cluster = new ocean.KubernetesCluster("cluster", {
  region: conf.require("region") as ocean.Region,
  version: conf.require("k8s_version"),
  nodePool: {
    maxNodes: 6,
    minNodes: 3,
    name: "default-pool",
    size: conf.get("node_slug") || "s-8vcpu-16gb" as any,
    autoScale: true,
  },
  vpcUuid: vpc.id,
},{
  parent: project,
});

// The DigitalOcean Kubernetes cluster periodically gets a new certificate,
// so we look up the cluster by name and get the current kubeconfig after
// initial provisioning. You'll notice that the `certificate-authority-data`
// field changes on every `pulumi update`.
export const kubeconfig = cluster.status.apply(status => {
  if (status === "running") {
    const clusterDataSource = cluster.name.apply(name => ocean.getKubernetesCluster({name}));
    return clusterDataSource.kubeConfigs[0].rawConfig;
  } else {
    return cluster.kubeConfigs[0].rawConfig;
  }
});

export const provider = new k8s.Provider("k8s-provider",
  { kubeconfig },
  { dependsOn: [cluster] },
);

export const pr = new ocean.ProjectResources("pr-cluster", {
  project: project.id,
  resources: [cluster.id.apply(id => "do:kubernetes:"+id)]
})

export default [
  vpc,
  cluster,
  kubeconfig,
  provider,
]
