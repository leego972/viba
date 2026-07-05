import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const deploymentTriggerTypeEnum = pgEnum("deployment_trigger_type", [
  "MANUAL",
  "GITHUB_PUSH",
  "ROLLBACK",
]);

export const deploymentStatusEnum = pgEnum("deployment_status", [
  "QUEUED",
  "BUILDING",
  "DEPLOYING",
  "LIVE",
  "FAILED",
  "ROLLED_BACK",
  "CANCELLED",
]);

export const addonTypeEnum = pgEnum("deploy_addon_type", [
  "POSTGRES",
  "REDIS",
]);

export const addonStatusEnum = pgEnum("deploy_addon_status", [
  "PROVISIONING",
  "RUNNING",
  "STOPPED",
  "FAILED",
  "DELETED",
]);

export const domainStatusEnum = pgEnum("deploy_domain_status", [
  "PENDING",
  "VERIFYING",
  "VERIFIED",
  "ACTIVE",
  "FAILED",
]);

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text("id").primaryKey().notNull(),
    installationId: integer("installation_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    targetType: text("target_type").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("github_installations_installation_id_idx").on(t.installationId)],
);

export const githubRepositories = pgTable(
  "github_repositories",
  {
    id: text("id").primaryKey().notNull(),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "cascade" }),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    defaultBranch: text("default_branch").notNull().default("main"),
    private: boolean("private").notNull().default(false),
    htmlUrl: text("html_url").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("github_repositories_full_name_idx").on(t.fullName),
    index("github_repositories_installation_id_idx").on(t.installationId),
  ],
);

export const vibaDeployProjects = pgTable(
  "viba_deploy_projects",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    ownerId: text("owner_id").notNull(),
    status: text("status").notNull().default("inactive"),
    liveUrl: text("live_url"),
    customDomain: text("custom_domain"),
    buildCommand: text("build_command"),
    startCommand: text("start_command"),
    installCommand: text("install_command"),
    rootDir: text("root_dir").default("."),
    envPort: text("env_port").default("3000"),
    cpuLimit: text("cpu_limit").default("0.5"),
    memoryLimit: text("memory_limit").default("512m"),
    renderServiceId: text("render_service_id"),
    renderRegion: text("render_region").default("oregon"),
    renderPlan: text("render_plan").default("starter"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("viba_deploy_projects_slug_idx").on(t.slug)],
);

export const projectGithubConnections = pgTable(
  "project_github_connections",
  {
    id: text("id").primaryKey().notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => vibaDeployProjects.id, { onDelete: "cascade" }),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallations.id),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => githubRepositories.id),
    deployBranch: text("deploy_branch").notNull().default("main"),
    autoDeployEnabled: boolean("auto_deploy_enabled").notNull().default(true),
    connectedAt: timestamp("connected_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("project_github_connections_project_id_idx").on(t.projectId),
    index("project_github_connections_installation_id_idx").on(t.installationId),
  ],
);

export const vibaDeployments = pgTable(
  "viba_deployments",
  {
    id: text("id").primaryKey().notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => vibaDeployProjects.id, { onDelete: "cascade" }),
    triggerType: deploymentTriggerTypeEnum("trigger_type").notNull().default("MANUAL"),
    status: deploymentStatusEnum("status").notNull().default("QUEUED"),
    commitSha: text("commit_sha"),
    commitMessage: text("commit_message"),
    commitAuthor: text("commit_author"),
    imageTag: text("image_tag"),
    renderDeployId: text("render_deploy_id"),
    previousDeploymentId: text("previous_deployment_id"),
    errorCategory: text("error_category"),
    errorSummary: text("error_summary"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("viba_deployments_project_id_idx").on(t.projectId),
    index("viba_deployments_status_idx").on(t.status),
  ],
);

export const vibaDeploymentLogs = pgTable(
  "viba_deployment_logs",
  {
    id: text("id").primaryKey().notNull(),
    deploymentId: text("deployment_id")
      .notNull()
      .references(() => vibaDeployments.id, { onDelete: "cascade" }),
    level: text("level").notNull().default("info"),
    message: text("message").notNull(),
    stream: text("stream").notNull().default("stdout"),
    timestamp: timestamp("timestamp").defaultNow().notNull(),
  },
  (t) => [
    index("viba_deployment_logs_deployment_id_idx").on(t.deploymentId),
    index("viba_deployment_logs_timestamp_idx").on(t.timestamp),
  ],
);

export const vibaDeployAddons = pgTable(
  "viba_deploy_addons",
  {
    id: text("id").primaryKey().notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => vibaDeployProjects.id, { onDelete: "cascade" }),
    type: addonTypeEnum("type").notNull(),
    status: addonStatusEnum("status").notNull().default("PROVISIONING"),
    containerName: text("container_name"),
    encryptedConnectionUrl: text("encrypted_connection_url"),
    envVarName: text("env_var_name").notNull(),
    volumeName: text("volume_name"),
    renderResourceId: text("render_resource_id"),
    managed: boolean("managed").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("viba_deploy_addons_project_id_idx").on(t.projectId),
  ],
);

export const vibaDeployDomains = pgTable(
  "viba_deploy_domains",
  {
    id: text("id").primaryKey().notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => vibaDeployProjects.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    status: domainStatusEnum("status").notNull().default("PENDING"),
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("viba_deploy_domains_domain_idx").on(t.domain),
    index("viba_deploy_domains_project_id_idx").on(t.projectId),
  ],
);

export const vibaDeployEnvVars = pgTable(
  "viba_deploy_env_vars",
  {
    id: text("id").primaryKey().notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => vibaDeployProjects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    managed: boolean("managed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("viba_deploy_env_vars_project_key_idx").on(t.projectId, t.key),
    index("viba_deploy_env_vars_project_id_idx").on(t.projectId),
  ],
);
