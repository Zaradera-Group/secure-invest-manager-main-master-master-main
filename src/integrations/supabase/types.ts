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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      announcements: {
        Row: {
          created_at: string
          detail: string
          id: string
          status: string
          title: string
        }
        Insert: {
          created_at?: string
          detail: string
          id?: string
          status: string
          title: string
        }
        Update: {
          created_at?: string
          detail?: string
          id?: string
          status?: string
          title?: string
        }
        Relationships: []
      }
      investors: {
          Row: {
            address: string | null
            bvn: string | null
            bvn_verification_status: string
            brought_by: string | null
            category_notes: string | null
            category_reference_email: string | null
            category_reference_name: string | null
            client_account_number: string
            client_bank: string
            created_at: string
            created_by: string | null
            currency_code: string
          date_of_birth: string | null
          email: string
          expected_maturity_amount: number
          gender: Database["public"]["Enums"]["gender_type"] | null
          id: string
            investment_amount: number
            investment_certificate_url: string | null
            investor_category: string
            investment_type: Database["public"]["Enums"]["investment_type"]
          last_verified_at: string | null
          liquidation_status: Database["public"]["Enums"]["liquidation_status"]
          maturity_date: string
          name: string
          next_of_kin_name: string | null
          next_of_kin_phone: string | null
          next_of_kin_relationship: string | null
          nin: string | null
          nin_verification_status: string
          occupation: string | null
          passport_photo_url: string | null
            percentage: number
            phone: string
            reference_number: number
            source_of_funds: string | null
            start_date: string
            tenure: number
          updated_at: string
          verification_provider: string | null
        }
          Insert: {
            address?: string | null
            bvn?: string | null
            bvn_verification_status?: string
            brought_by?: string | null
            category_notes?: string | null
            category_reference_email?: string | null
            category_reference_name?: string | null
            client_account_number: string
          client_bank: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          date_of_birth?: string | null
          email: string
          expected_maturity_amount: number
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
            investment_amount: number
            investment_certificate_url?: string | null
            investor_category?: string
            investment_type: Database["public"]["Enums"]["investment_type"]
          last_verified_at?: string | null
          liquidation_status?: Database["public"]["Enums"]["liquidation_status"]
          maturity_date: string
          name: string
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          next_of_kin_relationship?: string | null
          nin?: string | null
          nin_verification_status?: string
          occupation?: string | null
          passport_photo_url?: string | null
          percentage: number
          phone: string
          reference_number?: number
          source_of_funds?: string | null
          start_date: string
          tenure: number
          updated_at?: string
          verification_provider?: string | null
        }
          Update: {
            address?: string | null
            bvn?: string | null
            bvn_verification_status?: string
            brought_by?: string | null
            category_notes?: string | null
            category_reference_email?: string | null
            category_reference_name?: string | null
            client_account_number?: string
          client_bank?: string
          created_at?: string
          created_by?: string | null
          currency_code?: string
          date_of_birth?: string | null
          email?: string
          expected_maturity_amount?: number
          gender?: Database["public"]["Enums"]["gender_type"] | null
          id?: string
            investment_amount?: number
            investment_certificate_url?: string | null
            investor_category?: string
            investment_type?: Database["public"]["Enums"]["investment_type"]
          last_verified_at?: string | null
          liquidation_status?: Database["public"]["Enums"]["liquidation_status"]
          maturity_date?: string
          name?: string
          next_of_kin_name?: string | null
          next_of_kin_phone?: string | null
          next_of_kin_relationship?: string | null
          nin?: string | null
          nin_verification_status?: string
          occupation?: string | null
          passport_photo_url?: string | null
          percentage?: number
          phone?: string
          reference_number?: number
          source_of_funds?: string | null
          start_date?: string
          tenure?: number
          updated_at?: string
          verification_provider?: string | null
        }
        Relationships: []
      }
      certificate_approval_events: {
        Row: {
          action: string
          approver_id: string
          approver_role: Database["public"]["Enums"]["app_role"]
          certificate_id: string
          created_at: string
          id: string
          notes: string | null
          signature_url: string | null
        }
        Insert: {
          action: string
          approver_id: string
          approver_role: Database["public"]["Enums"]["app_role"]
          certificate_id: string
          created_at?: string
          id?: string
          notes?: string | null
          signature_url?: string | null
        }
        Update: {
          action?: string
          approver_id?: string
          approver_role?: Database["public"]["Enums"]["app_role"]
          certificate_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          signature_url?: string | null
        }
        Relationships: []
      }
      certificate_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: []
      }
      dashboard_notifications: {
        Row: {
          action_path: string | null
          created_at: string
          detail: string
          id: string
          is_read: boolean
          notification_type: string
          recipient_user_id: string | null
          related_investor_id: string | null
          target_role: Database["public"]["Enums"]["app_role"] | null
          title: string
        }
        Insert: {
          action_path?: string | null
          created_at?: string
          detail: string
          id?: string
          is_read?: boolean
          notification_type?: string
          recipient_user_id?: string | null
          related_investor_id?: string | null
          target_role?: Database["public"]["Enums"]["app_role"] | null
          title: string
        }
        Update: {
          action_path?: string | null
          created_at?: string
          detail?: string
          id?: string
          is_read?: boolean
          notification_type?: string
          recipient_user_id?: string | null
          related_investor_id?: string | null
          target_role?: Database["public"]["Enums"]["app_role"] | null
          title?: string
        }
        Relationships: []
      }
      investor_certificates: {
        Row: {
          calculated_interest_payment: number | null
          ceo_approved_at: string | null
          ceo_approved_by: string | null
          created_at: string
          created_by: string | null
          generated_storage_bucket: string
          generated_storage_path: string | null
          general_manager_signature_url: string | null
          general_manager_signed_at: string | null
          id: string
          investment_manager_signature_url: string | null
          investment_manager_signed_at: string | null
          investor_id: string
          issue_date: string
          last_generated_at: string | null
          mode_of_payment: string | null
          sent_at: string | null
          sent_by: string | null
          status: string
          template_id: string | null
          updated_at: string
        }
        Insert: {
          calculated_interest_payment?: number | null
          ceo_approved_at?: string | null
          ceo_approved_by?: string | null
          created_at?: string
          created_by?: string | null
          generated_storage_bucket?: string
          generated_storage_path?: string | null
          general_manager_signature_url?: string | null
          general_manager_signed_at?: string | null
          id?: string
          investment_manager_signature_url?: string | null
          investment_manager_signed_at?: string | null
          investor_id: string
          issue_date?: string
          last_generated_at?: string | null
          mode_of_payment?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          calculated_interest_payment?: number | null
          ceo_approved_at?: string | null
          ceo_approved_by?: string | null
          created_at?: string
          created_by?: string | null
          generated_storage_bucket?: string
          generated_storage_path?: string | null
          general_manager_signature_url?: string | null
          general_manager_signed_at?: string | null
          id?: string
          investment_manager_signature_url?: string | null
          investment_manager_signed_at?: string | null
          investor_id?: string
          issue_date?: string
          last_generated_at?: string | null
          mode_of_payment?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences: {
        Row: {
          user_id: string
          email_enabled: boolean
          maturity_reminders: boolean
          payment_reminders: boolean
          monthly_reports: boolean
          birthday_notifications: boolean
          reminder_days_before: number[]
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          email_enabled?: boolean
          maturity_reminders?: boolean
          payment_reminders?: boolean
          monthly_reports?: boolean
          birthday_notifications?: boolean
          reminder_days_before?: number[]
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          email_enabled?: boolean
          maturity_reminders?: boolean
          payment_reminders?: boolean
          monthly_reports?: boolean
          birthday_notifications?: boolean
          reminder_days_before?: number[]
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_notifications: {
        Row: {
          id: string
          user_id: string
          investor_id: string | null
          notification_type: string
          email_subject: string
          email_body: string
          sent_at: string
          delivery_status: string
          delivery_channel: string
          recipient: string
          error_message: string | null
          days_until_maturity: number | null
          investment_amount: number | null
          maturity_date: string | null
          provider_error_code: string | null
          provider_error_message: string | null
          provider_message_id: string | null
          provider_name: string | null
          provider_response: Json | null
          provider_status: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          investor_id?: string | null
          notification_type: string
          email_subject: string
          email_body: string
          sent_at?: string
          delivery_status?: string
          delivery_channel?: string
          recipient: string
          error_message?: string | null
          days_until_maturity?: number | null
          investment_amount?: number | null
          maturity_date?: string | null
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          provider_response?: Json | null
          provider_status?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          investor_id?: string | null
          notification_type?: string
          email_subject?: string
          email_body?: string
          sent_at?: string
          delivery_status?: string
          delivery_channel?: string
          recipient?: string
          error_message?: string | null
          days_until_maturity?: number | null
          investment_amount?: number | null
          maturity_date?: string | null
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          provider_response?: Json | null
          provider_status?: string | null
          created_at?: string
        }
        Relationships: []
      }
      email_notifications_archive: {
        Row: {
          archived_at: string
          created_at: string
          days_until_maturity: number | null
          delivery_channel: string
          delivery_status: string
          email_body: string
          email_subject: string
          error_message: string | null
          id: string
          investment_amount: number | null
          investor_id: string | null
          maturity_date: string | null
          notification_type: string
          provider_error_code: string | null
          provider_error_message: string | null
          provider_message_id: string | null
          provider_name: string | null
          provider_response: Json | null
          provider_status: string | null
          recipient: string
          sent_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string
          created_at?: string
          days_until_maturity?: number | null
          delivery_channel?: string
          delivery_status?: string
          email_body: string
          email_subject: string
          error_message?: string | null
          id?: string
          investment_amount?: number | null
          investor_id?: string | null
          maturity_date?: string | null
          notification_type: string
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          provider_response?: Json | null
          provider_status?: string | null
          recipient: string
          sent_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string
          created_at?: string
          days_until_maturity?: number | null
          delivery_channel?: string
          delivery_status?: string
          email_body?: string
          email_subject?: string
          error_message?: string | null
          id?: string
          investment_amount?: number | null
          investor_id?: string | null
          maturity_date?: string | null
          notification_type?: string
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_message_id?: string | null
          provider_name?: string | null
          provider_response?: Json | null
          provider_status?: string | null
          recipient?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          dedupe_key: string | null
          id: string
          investor_id: string | null
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          notification_type: string
          payload: Json
          processed_at: string | null
          scheduled_for: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          investor_id?: string | null
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          notification_type: string
          payload?: Json
          processed_at?: string | null
          scheduled_for?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          investor_id?: string | null
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          notification_type?: string
          payload?: Json
          processed_at?: string | null
          scheduled_for?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      notification_jobs_archive: {
        Row: {
          archived_at: string
          attempt_count: number
          created_at: string
          dedupe_key: string | null
          id: string
          investor_id: string | null
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          notification_type: string
          payload: Json
          processed_at: string | null
          scheduled_for: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          archived_at?: string
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          investor_id?: string | null
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          notification_type: string
          payload?: Json
          processed_at?: string | null
          scheduled_for?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          archived_at?: string
          attempt_count?: number
          created_at?: string
          dedupe_key?: string | null
          id?: string
          investor_id?: string | null
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          notification_type?: string
          payload?: Json
          processed_at?: string | null
          scheduled_for?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      job_runs: {
        Row: {
          batch_size: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          jobs_claimed: number
          jobs_completed: number
          jobs_failed: number
          metadata: Json
          started_at: string
          status: string
          worker_name: string
        }
        Insert: {
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          jobs_claimed?: number
          jobs_completed?: number
          jobs_failed?: number
          metadata?: Json
          started_at?: string
          status?: string
          worker_name: string
        }
        Update: {
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          jobs_claimed?: number
          jobs_completed?: number
          jobs_failed?: number
          metadata?: Json
          started_at?: string
          status?: string
          worker_name?: string
        }
        Relationships: []
      }
      job_runs_archive: {
        Row: {
          archived_at: string
          batch_size: number
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          jobs_claimed: number
          jobs_completed: number
          jobs_failed: number
          metadata: Json
          started_at: string
          status: string
          worker_name: string
        }
        Insert: {
          archived_at?: string
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          jobs_claimed?: number
          jobs_completed?: number
          jobs_failed?: number
          metadata?: Json
          started_at?: string
          status?: string
          worker_name: string
        }
        Update: {
          archived_at?: string
          batch_size?: number
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          jobs_claimed?: number
          jobs_completed?: number
          jobs_failed?: number
          metadata?: Json
          started_at?: string
          status?: string
          worker_name?: string
        }
        Relationships: []
      }
    }
    Views: {
      dashboard_investment_type_summary: {
        Row: {
          investment_type: Database["public"]["Enums"]["investment_type"] | null
          investor_count: number | null
          total_investment_value: number | null
          user_id: string | null
        }
        Relationships: []
      }
      dashboard_portfolio_summary: {
        Row: {
          active_investments: number | null
          liquidated_investments: number | null
          maturing_soon: number | null
          total_investment_value: number | null
          total_investments: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      archive_notification_history: {
        Args: {
          completed_job_archive_days?: number
          email_notification_archive_days?: number
          job_run_archive_days?: number
        }
        Returns: Json
      }
      claim_notification_jobs: {
        Args: {
          batch_size?: number
        }
        Returns: Database["public"]["Tables"]["notification_jobs"]["Row"][]
      }
      cleanup_notification_history: {
        Args: {
          audit_log_retention_days?: number
          completed_job_retention_days?: number
          email_notification_retention_days?: number
          job_run_retention_days?: number
        }
        Returns: Json
      }
      get_dashboard_upcoming_maturities: {
        Args: {
          limit_count?: number
        }
        Returns: {
          id: string
          investment_amount: number
          investment_type: Database["public"]["Enums"]["investment_type"]
          liquidation_status: Database["public"]["Enums"]["liquidation_status"]
          maturity_date: string
          name: string
        }[]
      }
      get_maturity_alerts: {
        Args: {
          limit_count?: number
          offset_count?: number
        }
        Returns: {
          client_bank: string
          expected_maturity_amount: number
          id: string
          investment_type: Database["public"]["Enums"]["investment_type"]
          liquidation_status: Database["public"]["Enums"]["liquidation_status"]
          maturity_date: string
          name: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      requeue_stale_notification_jobs: {
        Args: {
          stale_after_minutes?: number
        }
        Returns: number
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "staff"
        | "investment_manager"
        | "accountant"
        | "general_manager"
        | "software_engineer"
      gender_type: "Male" | "Female" | "Other"
      investment_type: "Upfront" | "Monthly" | "Quarterly" | "At Maturity"
      liquidation_status: "Active" | "Matured" | "Liquidated" | "Pending"
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
  PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals },
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
    Enums: {
      app_role: ["super_admin", "admin", "staff", "investment_manager", "accountant", "general_manager", "software_engineer"],
      gender_type: ["Male", "Female", "Other"],
      investment_type: ["Upfront", "Monthly", "Quarterly", "At Maturity"],
      liquidation_status: ["Active", "Matured", "Liquidated", "Pending"],
    },
  },
} as const
