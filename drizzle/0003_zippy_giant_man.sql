CREATE TABLE "mcp_bridges" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"endpoint_url" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'NOT CONFIGURED' NOT NULL,
	"protocol_version" text,
	"server_name" text,
	"server_version" text,
	"tool_count" integer DEFAULT 0 NOT NULL,
	"tools_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"last_latency_ms" integer,
	"last_connected_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
