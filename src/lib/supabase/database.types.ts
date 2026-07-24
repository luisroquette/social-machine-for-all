export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_campaigns: {
        Row: {
          created_at: string | null
          daily_budget: number | null
          external_campaign_id: string | null
          id: string
          last_synced_at: string | null
          name: string
          performance: Json | null
          platform: string
          status: string | null
          total_spent: number | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          daily_budget?: number | null
          external_campaign_id?: string | null
          id?: string
          last_synced_at?: string | null
          name: string
          performance?: Json | null
          platform: string
          status?: string | null
          total_spent?: number | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          daily_budget?: number | null
          external_campaign_id?: string | null
          id?: string
          last_synced_at?: string | null
          name?: string
          performance?: Json | null
          platform?: string
          status?: string | null
          total_spent?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ad_performance: {
        Row: {
          campaign_id: string
          clicks: number | null
          conversions: number | null
          cpa: number | null
          cpc: number | null
          ctr: number | null
          date: string
          id: string
          impressions: number | null
          metadata: Json | null
          roas: number | null
          spend: number | null
        }
        Insert: {
          campaign_id: string
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          ctr?: number | null
          date: string
          id?: string
          impressions?: number | null
          metadata?: Json | null
          roas?: number | null
          spend?: number | null
        }
        Update: {
          campaign_id?: string
          clicks?: number | null
          conversions?: number | null
          cpa?: number | null
          cpc?: number | null
          ctr?: number | null
          date?: string
          id?: string
          impressions?: number | null
          metadata?: Json | null
          roas?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ad_performance_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "ad_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_actions: {
        Row: {
          action_type: string
          agent_id: string | null
          cost_estimate: number | null
          created_at: string | null
          duration_ms: number | null
          error_message: string | null
          id: string
          input_summary: string | null
          items_processed: number | null
          items_produced: number | null
          metadata: Json | null
          output_summary: string | null
          pipeline_run_id: string | null
          pipeline_stage: string | null
          status: string | null
          tokens_used: number | null
          workspace_id: string
        }
        Insert: {
          action_type: string
          agent_id?: string | null
          cost_estimate?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_summary?: string | null
          items_processed?: number | null
          items_produced?: number | null
          metadata?: Json | null
          output_summary?: string | null
          pipeline_run_id?: string | null
          pipeline_stage?: string | null
          status?: string | null
          tokens_used?: number | null
          workspace_id: string
        }
        Update: {
          action_type?: string
          agent_id?: string | null
          cost_estimate?: number | null
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          input_summary?: string | null
          items_processed?: number | null
          items_produced?: number | null
          metadata?: Json | null
          output_summary?: string | null
          pipeline_run_id?: string | null
          pipeline_stage?: string | null
          status?: string | null
          tokens_used?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_actions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_agent_actions_pipeline"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_memories: {
        Row: {
          agent_slug: string
          category: string
          content: string
          context: Json | null
          created_at: string | null
          expires_at: string | null
          id: string
          relevance_score: number | null
          shared: boolean | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          agent_slug: string
          category: string
          content: string
          context?: Json | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          relevance_score?: number | null
          shared?: boolean | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          agent_slug?: string
          category?: string
          content?: string
          context?: Json | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          relevance_score?: number | null
          shared?: boolean | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_memories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active: boolean | null
          avg_score: number | null
          config: Json | null
          created_at: string | null
          id: string
          last_run_at: string | null
          max_actions_per_hour: number | null
          model: string | null
          name: string
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          role: string
          schedule_cron: string | null
          schedule_enabled: boolean | null
          slug: string
          system_prompt: string | null
          telegram_bot_token: string | null
          telegram_bot_username: string | null
          total_runs: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          active?: boolean | null
          avg_score?: number | null
          config?: Json | null
          created_at?: string | null
          id?: string
          last_run_at?: string | null
          max_actions_per_hour?: number | null
          model?: string | null
          name: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          role: string
          schedule_cron?: string | null
          schedule_enabled?: boolean | null
          slug: string
          system_prompt?: string | null
          telegram_bot_token?: string | null
          telegram_bot_username?: string | null
          total_runs?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          active?: boolean | null
          avg_score?: number | null
          config?: Json | null
          created_at?: string | null
          id?: string
          last_run_at?: string | null
          max_actions_per_hour?: number | null
          model?: string | null
          name?: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          role?: string
          schedule_cron?: string | null
          schedule_enabled?: boolean | null
          slug?: string
          system_prompt?: string | null
          telegram_bot_token?: string | null
          telegram_bot_username?: string | null
          total_runs?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      br_trend_topics: {
        Row: {
          category: string
          country_code: string
          created_at: string
          detected_at: string
          expires_at: string | null
          id: string
          normalized_topic: string
          rank_position: number | null
          raw_payload: Json
          region: string | null
          related_news: Json
          safety_flags: string[]
          safety_status: string
          source: string
          status: string
          topic: string
          trend_score: number
          volume_label: string | null
          volume_score: number
          workspace_id: string
        }
        Insert: {
          category?: string
          country_code?: string
          created_at?: string
          detected_at?: string
          expires_at?: string | null
          id?: string
          normalized_topic: string
          rank_position?: number | null
          raw_payload?: Json
          region?: string | null
          related_news?: Json
          safety_flags?: string[]
          safety_status?: string
          source: string
          status?: string
          topic: string
          trend_score?: number
          volume_label?: string | null
          volume_score?: number
          workspace_id: string
        }
        Update: {
          category?: string
          country_code?: string
          created_at?: string
          detected_at?: string
          expires_at?: string | null
          id?: string
          normalized_topic?: string
          rank_position?: number | null
          raw_payload?: Json
          region?: string | null
          related_news?: Json
          safety_flags?: string[]
          safety_status?: string
          source?: string
          status?: string
          topic?: string
          trend_score?: number
          volume_label?: string | null
          volume_score?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "br_trend_topics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      curated_content: {
        Row: {
          created_at: string | null
          id: string
          keyword_fingerprint: string[] | null
          pipeline_run_id: string | null
          relevance_score: number | null
          score_breakdown: Json | null
          skip_reason: string | null
          skip_until: string | null
          source_author: string | null
          source_content: string
          source_metrics: Json | null
          source_platform: string
          source_url: string | null
          status: string | null
          topic_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          keyword_fingerprint?: string[] | null
          pipeline_run_id?: string | null
          relevance_score?: number | null
          score_breakdown?: Json | null
          skip_reason?: string | null
          skip_until?: string | null
          source_author?: string | null
          source_content: string
          source_metrics?: Json | null
          source_platform: string
          source_url?: string | null
          status?: string | null
          topic_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          keyword_fingerprint?: string[] | null
          pipeline_run_id?: string | null
          relevance_score?: number | null
          score_breakdown?: Json | null
          skip_reason?: string | null
          skip_until?: string | null
          source_author?: string | null
          source_content?: string
          source_metrics?: Json | null
          source_platform?: string
          source_url?: string | null
          status?: string | null
          topic_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "curated_content_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curated_content_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "trending_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "curated_content_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      editorial_calendar: {
        Row: {
          content_type: string | null
          created_at: string | null
          generated_content_id: string | null
          id: string
          planned_date: string
          status: string | null
          strategy_notes: string | null
          target_platform: string | null
          theme: string
          workspace_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string | null
          generated_content_id?: string | null
          id?: string
          planned_date: string
          status?: string | null
          strategy_notes?: string | null
          target_platform?: string | null
          theme: string
          workspace_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string | null
          generated_content_id?: string | null
          id?: string
          planned_date?: string
          status?: string | null
          strategy_notes?: string | null
          target_platform?: string | null
          theme?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "editorial_calendar_generated_content_id_fkey"
            columns: ["generated_content_id"]
            isOneToOne: false
            referencedRelation: "generated_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "editorial_calendar_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_actions: {
        Row: {
          action_type: string
          agent_slug: string
          comment_style: string | null
          comment_text: string | null
          created_at: string | null
          executed_at: string | null
          id: string
          metadata: Json | null
          status: string | null
          target_author: string | null
          target_platform: string
          target_url: string | null
          workspace_id: string
        }
        Insert: {
          action_type: string
          agent_slug: string
          comment_style?: string | null
          comment_text?: string | null
          created_at?: string | null
          executed_at?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          target_author?: string | null
          target_platform: string
          target_url?: string | null
          workspace_id: string
        }
        Update: {
          action_type?: string
          agent_slug?: string
          comment_style?: string | null
          comment_text?: string | null
          created_at?: string | null
          executed_at?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          target_author?: string | null
          target_platform?: string
          target_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_profiles: {
        Row: {
          active: boolean | null
          config: Json | null
          created_at: string | null
          handle: string
          id: string
          last_engaged_at: string | null
          platform: string
          workspace_id: string
        }
        Insert: {
          active?: boolean | null
          config?: Json | null
          created_at?: string | null
          handle: string
          id?: string
          last_engaged_at?: string | null
          platform: string
          workspace_id: string
        }
        Update: {
          active?: boolean | null
          config?: Json | null
          created_at?: string | null
          handle?: string
          id?: string
          last_engaged_at?: string | null
          platform?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "engagement_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      eval_dataset: {
        Row: {
          action_id: string | null
          agent_slug: string
          auto_score: number | null
          created_at: string | null
          dimensions: Json | null
          feedback: string | null
          human_score: number | null
          id: string
          input_summary: string | null
          issues: string[] | null
          output_summary: string | null
          verdict: string | null
          workspace_id: string
        }
        Insert: {
          action_id?: string | null
          agent_slug: string
          auto_score?: number | null
          created_at?: string | null
          dimensions?: Json | null
          feedback?: string | null
          human_score?: number | null
          id?: string
          input_summary?: string | null
          issues?: string[] | null
          output_summary?: string | null
          verdict?: string | null
          workspace_id: string
        }
        Update: {
          action_id?: string | null
          agent_slug?: string
          auto_score?: number | null
          created_at?: string | null
          dimensions?: Json | null
          feedback?: string | null
          human_score?: number | null
          id?: string
          input_summary?: string | null
          issues?: string[] | null
          output_summary?: string | null
          verdict?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eval_dataset_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "agent_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eval_dataset_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_marketing_assets: {
        Row: {
          caption: string
          created_at: string
          id: string
          pillar: string
          public_url: string
          seasonal_slug: string | null
          storage_path: string
          used_at: string | null
          workspace_id: string
        }
        Insert: {
          caption: string
          created_at?: string
          id?: string
          pillar: string
          public_url: string
          seasonal_slug?: string | null
          storage_path: string
          used_at?: string | null
          workspace_id: string
        }
        Update: {
          caption?: string
          created_at?: string
          id?: string
          pillar?: string
          public_url?: string
          seasonal_slug?: string | null
          storage_path?: string
          used_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_marketing_assets_seasonal_slug_fkey"
            columns: ["seasonal_slug"]
            isOneToOne: false
            referencedRelation: "brand_seasonal_dates"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "brand_marketing_assets_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_pillar_facts: {
        Row: {
          created_at: string
          fact: string
          id: string
          pillar: string
          source: string | null
          used_count: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          fact: string
          id?: string
          pillar: string
          source?: string | null
          used_count?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          fact?: string
          id?: string
          pillar?: string
          source?: string | null
          used_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_pillar_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_seasonal_dates: {
        Row: {
          angle: string
          created_at: string
          day: number | null
          easter_offset_days: number | null
          enabled: boolean
          id: string
          is_priority: boolean
          last_used_year: number | null
          month: number | null
          name: string
          restriction_notes: string | null
          slug: string
          workspace_id: string
        }
        Insert: {
          angle: string
          created_at?: string
          day?: number | null
          easter_offset_days?: number | null
          enabled?: boolean
          id?: string
          is_priority?: boolean
          last_used_year?: number | null
          month?: number | null
          name: string
          restriction_notes?: string | null
          slug: string
          workspace_id: string
        }
        Update: {
          angle?: string
          created_at?: string
          day?: number | null
          easter_offset_days?: number | null
          enabled?: boolean
          id?: string
          is_priority?: boolean
          last_used_year?: number | null
          month?: number | null
          name?: string
          restriction_notes?: string | null
          slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brand_seasonal_dates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      generated_content: {
        Row: {
          content: string
          created_at: string | null
          curated_content_id: string | null
          engagement_metrics: Json | null
          engagement_rate: number | null
          engagement_score: number | null
          id: string
          idioma: string
          metadata: Json | null
          model_used: string | null
          pipeline_run_id: string | null
          published_at: string | null
          published_id: string | null
          published_url: string | null
          reach: number | null
          retry_count: number | null
          review_feedback: string | null
          review_issues: string[] | null
          review_score: number | null
          status: string | null
          story_cover_url: string | null
          story_delay_minutes: number | null
          story_publish_after: string | null
          story_video_url: string | null
          target_format: string
          target_platform: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          curated_content_id?: string | null
          engagement_metrics?: Json | null
          engagement_rate?: number | null
          engagement_score?: number | null
          id?: string
          idioma?: string
          metadata?: Json | null
          model_used?: string | null
          pipeline_run_id?: string | null
          published_at?: string | null
          published_id?: string | null
          published_url?: string | null
          reach?: number | null
          retry_count?: number | null
          review_feedback?: string | null
          review_issues?: string[] | null
          review_score?: number | null
          status?: string | null
          story_cover_url?: string | null
          story_delay_minutes?: number | null
          story_publish_after?: string | null
          story_video_url?: string | null
          target_format: string
          target_platform: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          curated_content_id?: string | null
          engagement_metrics?: Json | null
          engagement_rate?: number | null
          engagement_score?: number | null
          id?: string
          idioma?: string
          metadata?: Json | null
          model_used?: string | null
          pipeline_run_id?: string | null
          published_at?: string | null
          published_id?: string | null
          published_url?: string | null
          reach?: number | null
          retry_count?: number | null
          review_feedback?: string | null
          review_issues?: string[] | null
          review_score?: number | null
          status?: string | null
          story_cover_url?: string | null
          story_delay_minutes?: number | null
          story_publish_after?: string | null
          story_video_url?: string | null
          target_format?: string
          target_platform?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generated_content_curated_content_id_fkey"
            columns: ["curated_content_id"]
            isOneToOne: false
            referencedRelation: "curated_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_content_pipeline_run_id_fkey"
            columns: ["pipeline_run_id"]
            isOneToOne: false
            referencedRelation: "pipeline_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generated_content_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_comment_interactions: {
        Row: {
          ai_reply: string | null
          attempts: number
          comment_id: string
          created_at: string
          from_id: string
          from_username: string | null
          id: number
          last_error: string | null
          media_id: string | null
          parent_id: string | null
          processed_at: string | null
          reply_comment_id: string | null
          skip_reason: string | null
          skip_until: string | null
          status: string
          text: string | null
          workspace_id: string
        }
        Insert: {
          ai_reply?: string | null
          attempts?: number
          comment_id: string
          created_at?: string
          from_id: string
          from_username?: string | null
          id?: number
          last_error?: string | null
          media_id?: string | null
          parent_id?: string | null
          processed_at?: string | null
          reply_comment_id?: string | null
          skip_reason?: string | null
          skip_until?: string | null
          status?: string
          text?: string | null
          workspace_id: string
        }
        Update: {
          ai_reply?: string | null
          attempts?: number
          comment_id?: string
          created_at?: string
          from_id?: string
          from_username?: string | null
          id?: number
          last_error?: string | null
          media_id?: string | null
          parent_id?: string | null
          processed_at?: string | null
          reply_comment_id?: string | null
          skip_reason?: string | null
          skip_until?: string | null
          status?: string
          text?: string | null
          workspace_id?: string
        }
        Relationships: []
      }
      instagram_dm_interactions: {
        Row: {
          created_at: string
          from_id: string
          id: number
          last_error: string | null
          matched_lead_id: string | null
          message_id: string
          processed_at: string | null
          status: string
          text: string
          to_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          from_id: string
          id?: number
          last_error?: string | null
          matched_lead_id?: string | null
          message_id: string
          processed_at?: string | null
          status?: string
          text: string
          to_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          from_id?: string
          id?: number
          last_error?: string | null
          matched_lead_id?: string | null
          message_id?: string
          processed_at?: string | null
          status?: string
          text?: string
          to_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_dm_interactions_matched_lead_id_fkey"
            columns: ["matched_lead_id"]
            isOneToOne: false
            referencedRelation: "instagram_giveaway_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_dm_interactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_giveaway_leads: {
        Row: {
          comment_interaction_id: number | null
          comment_reply_text: string | null
          comment_text: string | null
          commenter_ig_user_id: string
          commenter_username: string | null
          conversion_event: string | null
          converted_at: string | null
          created_at: string
          delivered_at: string | null
          delivered_message_id: string | null
          dm_received_at: string | null
          dm_text: string | null
          follow_requested_at: string | null
          generated_content_id: string | null
          id: string
          instagram_media_id: string | null
          keyword: string
          last_error: string | null
          qualified_at: string | null
          replied_at: string | null
          requested_at: string
          status: string
          trend_video_job_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          comment_interaction_id?: number | null
          comment_reply_text?: string | null
          comment_text?: string | null
          commenter_ig_user_id: string
          commenter_username?: string | null
          conversion_event?: string | null
          converted_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_message_id?: string | null
          dm_received_at?: string | null
          dm_text?: string | null
          follow_requested_at?: string | null
          generated_content_id?: string | null
          id?: string
          instagram_media_id?: string | null
          keyword: string
          last_error?: string | null
          qualified_at?: string | null
          replied_at?: string | null
          requested_at?: string
          status?: string
          trend_video_job_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          comment_interaction_id?: number | null
          comment_reply_text?: string | null
          comment_text?: string | null
          commenter_ig_user_id?: string
          commenter_username?: string | null
          conversion_event?: string | null
          converted_at?: string | null
          created_at?: string
          delivered_at?: string | null
          delivered_message_id?: string | null
          dm_received_at?: string | null
          dm_text?: string | null
          follow_requested_at?: string | null
          generated_content_id?: string | null
          id?: string
          instagram_media_id?: string | null
          keyword?: string
          last_error?: string | null
          qualified_at?: string | null
          replied_at?: string | null
          requested_at?: string
          status?: string
          trend_video_job_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_giveaway_leads_comment_interaction_id_fkey"
            columns: ["comment_interaction_id"]
            isOneToOne: false
            referencedRelation: "instagram_comment_interactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_giveaway_leads_generated_content_id_fkey"
            columns: ["generated_content_id"]
            isOneToOne: false
            referencedRelation: "generated_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_giveaway_leads_trend_video_job_id_fkey"
            columns: ["trend_video_job_id"]
            isOneToOne: false
            referencedRelation: "trend_video_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_giveaway_leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_static_news_queue: {
        Row: {
          created_at: string | null
          curated_content_id: string
          id: string
          image_urls: string[] | null
          launch_category: string
          launch_reasons: string[] | null
          launch_score: number
          media_mode: string
          metadata: Json | null
          primary_image_url: string | null
          source_author: string | null
          source_content: string
          source_metrics: Json | null
          source_platform: string
          source_url: string | null
          status: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          curated_content_id: string
          id?: string
          image_urls?: string[] | null
          launch_category: string
          launch_reasons?: string[] | null
          launch_score?: number
          media_mode: string
          metadata?: Json | null
          primary_image_url?: string | null
          source_author?: string | null
          source_content: string
          source_metrics?: Json | null
          source_platform: string
          source_url?: string | null
          status?: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          curated_content_id?: string
          id?: string
          image_urls?: string[] | null
          launch_category?: string
          launch_reasons?: string[] | null
          launch_score?: number
          media_mode?: string
          metadata?: Json | null
          primary_image_url?: string | null
          source_author?: string | null
          source_content?: string
          source_metrics?: Json | null
          source_platform?: string
          source_url?: string | null
          status?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_static_news_queue_curated_content_id_fkey"
            columns: ["curated_content_id"]
            isOneToOne: true
            referencedRelation: "curated_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_static_news_queue_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      monitor_sources: {
        Row: {
          active: boolean | null
          created_at: string | null
          exclude_keywords: string[] | null
          feed_url: string | null
          handle: string | null
          id: string
          keywords: string[] | null
          last_checked_at: string | null
          min_engagement: number | null
          platform: string
          workspace_id: string
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          exclude_keywords?: string[] | null
          feed_url?: string | null
          handle?: string | null
          id?: string
          keywords?: string[] | null
          last_checked_at?: string | null
          min_engagement?: number | null
          platform: string
          workspace_id: string
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          exclude_keywords?: string[] | null
          feed_url?: string | null
          handle?: string | null
          id?: string
          keywords?: string[] | null
          last_checked_at?: string | null
          min_engagement?: number | null
          platform?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "monitor_sources_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_snapshots: {
        Row: {
          created_at: string | null
          id: string
          insights: string[] | null
          metrics: Json
          period_end: string
          period_start: string
          recommendations: string[] | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          insights?: string[] | null
          metrics?: Json
          period_end: string
          period_start: string
          recommendations?: string[] | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          insights?: string[] | null
          metrics?: Json
          period_end?: string
          period_start?: string
          recommendations?: string[] | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_snapshots_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_runs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          stages_completed: string[] | null
          started_at: string | null
          status: string | null
          trigger: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          stages_completed?: string[] | null
          started_at?: string | null
          status?: string | null
          trigger?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          stages_completed?: string[] | null
          started_at?: string | null
          status?: string | null
          trigger?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_configs: {
        Row: {
          active: boolean | null
          allow_emojis: boolean | null
          allow_hashtags: boolean | null
          created_at: string | null
          engagement_style: string | null
          hashtag_strategy: string | null
          id: string
          max_hashtags: number | null
          max_length: number
          platform: string
          require_image: boolean | null
          style_guide: string | null
          tone: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          active?: boolean | null
          allow_emojis?: boolean | null
          allow_hashtags?: boolean | null
          created_at?: string | null
          engagement_style?: string | null
          hashtag_strategy?: string | null
          id?: string
          max_hashtags?: number | null
          max_length: number
          platform: string
          require_image?: boolean | null
          style_guide?: string | null
          tone?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          active?: boolean | null
          allow_emojis?: boolean | null
          allow_hashtags?: boolean | null
          created_at?: string | null
          engagement_style?: string | null
          hashtag_strategy?: string | null
          id?: string
          max_hashtags?: number | null
          max_length?: number
          platform?: string
          require_image?: boolean | null
          style_guide?: string | null
          tone?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_metrics_snapshots: {
        Row: {
          created_at: string
          followers_count: number | null
          id: string
          media_count: number | null
          snapshot_date: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          followers_count?: number | null
          id?: string
          media_count?: number | null
          snapshot_date: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          followers_count?: number | null
          id?: string
          media_count?: number | null
          snapshot_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      seo_audits: {
        Row: {
          audit_type: string | null
          created_at: string | null
          domain: string
          id: string
          issues: Json | null
          raw_data: Json | null
          recommendations: Json | null
          score: number | null
          workspace_id: string
        }
        Insert: {
          audit_type?: string | null
          created_at?: string | null
          domain: string
          id?: string
          issues?: Json | null
          raw_data?: Json | null
          recommendations?: Json | null
          score?: number | null
          workspace_id: string
        }
        Update: {
          audit_type?: string | null
          created_at?: string | null
          domain?: string
          id?: string
          issues?: Json | null
          raw_data?: Json | null
          recommendations?: Json | null
          score?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_audits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_keywords: {
        Row: {
          created_at: string | null
          current_rank: number | null
          difficulty: number | null
          id: string
          keyword: string
          last_checked_at: string | null
          opportunity_score: number | null
          search_volume: number | null
          status: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          current_rank?: number | null
          difficulty?: number | null
          id?: string
          keyword: string
          last_checked_at?: string | null
          opportunity_score?: number | null
          search_volume?: number | null
          status?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          current_rank?: number | null
          difficulty?: number | null
          id?: string
          keyword?: string
          last_checked_at?: string | null
          opportunity_score?: number | null
          search_volume?: number | null
          status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_keywords_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_conversations: {
        Row: {
          chat_id: number
          content: string
          created_at: string | null
          id: string
          role: string
        }
        Insert: {
          chat_id: number
          content: string
          created_at?: string | null
          id?: string
          role: string
        }
        Update: {
          chat_id?: number
          content?: string
          created_at?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      telegram_message_queue: {
        Row: {
          chat_id: number
          created_at: string | null
          from_user: Json | null
          id: string
          media_file_id: string | null
          media_type: string | null
          message_id: number
          processed_at: string | null
          status: string | null
          text: string | null
        }
        Insert: {
          chat_id: number
          created_at?: string | null
          from_user?: Json | null
          id?: string
          media_file_id?: string | null
          media_type?: string | null
          message_id: number
          processed_at?: string | null
          status?: string | null
          text?: string | null
        }
        Update: {
          chat_id?: number
          created_at?: string | null
          from_user?: Json | null
          id?: string
          media_file_id?: string | null
          media_type?: string | null
          message_id?: number
          processed_at?: string | null
          status?: string | null
          text?: string | null
        }
        Relationships: []
      }
      trend_style_stats: {
        Row: {
          avg_comments: number | null
          avg_dm_qualified: number | null
          avg_follow_delta: number | null
          avg_giveaway_deliveries: number | null
          avg_likes: number | null
          avg_prompt_requests: number | null
          avg_reach: number | null
          avg_saves: number | null
          avg_shares: number | null
          avg_views: number | null
          avg_watch_time: number | null
          delivery_rate: number | null
          dm_conversion_rate: number | null
          hook_pattern: string
          id: string
          posts_count: number
          prompt_request_rate: number | null
          style: string
          topic_category: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          avg_comments?: number | null
          avg_dm_qualified?: number | null
          avg_follow_delta?: number | null
          avg_giveaway_deliveries?: number | null
          avg_likes?: number | null
          avg_prompt_requests?: number | null
          avg_reach?: number | null
          avg_saves?: number | null
          avg_shares?: number | null
          avg_views?: number | null
          avg_watch_time?: number | null
          delivery_rate?: number | null
          dm_conversion_rate?: number | null
          hook_pattern: string
          id?: string
          posts_count?: number
          prompt_request_rate?: number | null
          style: string
          topic_category: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          avg_comments?: number | null
          avg_dm_qualified?: number | null
          avg_follow_delta?: number | null
          avg_giveaway_deliveries?: number | null
          avg_likes?: number | null
          avg_prompt_requests?: number | null
          avg_reach?: number | null
          avg_saves?: number | null
          avg_shares?: number | null
          avg_views?: number | null
          avg_watch_time?: number | null
          delivery_rate?: number | null
          dm_conversion_rate?: number | null
          hook_pattern?: string
          id?: string
          posts_count?: number
          prompt_request_rate?: number | null
          style?: string
          topic_category?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trend_style_stats_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      trend_video_jobs: {
        Row: {
          angle: string
          base_image_url: string | null
          caption: string
          cover_title: string
          cover_url: string | null
          created_at: string
          cta_text: string | null
          duration_sec: number
          error_code: string | null
          error_message: string | null
          generation_memory: Json
          hook_title: string
          id: string
          image_prompt: string
          image_provider: string | null
          motion_prompt: string
          provider_job_id: string | null
          provider_model: string | null
          published_generated_content_id: string | null
          shot_plan: Json
          shot_results: Json
          status: string
          style: string
          trend_topic_id: string
          updated_at: string
          video_provider: string
          video_url: string | null
          workspace_id: string
        }
        Insert: {
          angle: string
          base_image_url?: string | null
          caption: string
          cover_title: string
          cover_url?: string | null
          created_at?: string
          cta_text?: string | null
          duration_sec?: number
          error_code?: string | null
          error_message?: string | null
          generation_memory?: Json
          hook_title: string
          id?: string
          image_prompt: string
          image_provider?: string | null
          motion_prompt: string
          provider_job_id?: string | null
          provider_model?: string | null
          published_generated_content_id?: string | null
          shot_plan?: Json
          shot_results?: Json
          status?: string
          style: string
          trend_topic_id: string
          updated_at?: string
          video_provider?: string
          video_url?: string | null
          workspace_id: string
        }
        Update: {
          angle?: string
          base_image_url?: string | null
          caption?: string
          cover_title?: string
          cover_url?: string | null
          created_at?: string
          cta_text?: string | null
          duration_sec?: number
          error_code?: string | null
          error_message?: string | null
          generation_memory?: Json
          hook_title?: string
          id?: string
          image_prompt?: string
          image_provider?: string | null
          motion_prompt?: string
          provider_job_id?: string | null
          provider_model?: string | null
          published_generated_content_id?: string | null
          shot_plan?: Json
          shot_results?: Json
          status?: string
          style?: string
          trend_topic_id?: string
          updated_at?: string
          video_provider?: string
          video_url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trend_video_jobs_published_generated_content_id_fkey"
            columns: ["published_generated_content_id"]
            isOneToOne: false
            referencedRelation: "generated_content"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trend_video_jobs_trend_topic_id_fkey"
            columns: ["trend_topic_id"]
            isOneToOne: false
            referencedRelation: "br_trend_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trend_video_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      trending_topics: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          detected_at: string | null
          expires_at: string | null
          hashtags: string[] | null
          id: string
          metadata: Json | null
          relevance: string | null
          source: string | null
          status: string | null
          title: string
          volume: number | null
          workspace_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          detected_at?: string | null
          expires_at?: string | null
          hashtags?: string[] | null
          id?: string
          metadata?: Json | null
          relevance?: string | null
          source?: string | null
          status?: string | null
          title: string
          volume?: number | null
          workspace_id: string
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          detected_at?: string | null
          expires_at?: string | null
          hashtags?: string[] | null
          id?: string
          metadata?: Json | null
          relevance?: string | null
          source?: string | null
          status?: string | null
          title?: string
          volume?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trending_topics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          category: string
          created_at: string | null
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: string
          workspace_id: string
        }
        Insert: {
          category: string
          created_at?: string | null
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value: string
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string | null
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          active: boolean | null
          brand_config: Json | null
          created_at: string | null
          description: string | null
          id: string
          name: string
          owner_id: string | null
          platform_credentials: Json | null
          slug: string
          telegram_group_id: number | null
          topic_keywords: string[] | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          brand_config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          owner_id?: string | null
          platform_credentials?: Json | null
          slug: string
          telegram_group_id?: number | null
          topic_keywords?: string[] | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          brand_config?: Json | null
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          owner_id?: string | null
          platform_credentials?: Json | null
          slug?: string
          telegram_group_id?: number | null
          topic_keywords?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
