export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ============================================================================
// DOMAIN ENUMS & UNION TYPES (Khớp 100% với Mục 5 & Mục 12 PRD_SPEC.md)
// ============================================================================

export type StaffRole = 'admin' | 'staff' | 'kitchen';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED';

export type InventoryLogType = 'IMPORT' | 'EXPORT_SALE' | 'RETURN_BEER' | 'WASTAGE';

export type MenuCategory = 'FOOD' | 'BEER' | 'DRINK' | 'OTHER';

export type StationType = 'KITCHEN' | 'BAR_INSTANT';

export type SessionType = 'DINE_IN' | 'TAKEAWAY';

export type TableSessionStatus =
  | 'PENDING_PAYMENT'
  | 'ACTIVE'
  | 'REQUEST_BILL'
  | 'CLOSED';

export type PaymentMethod = 'CASH' | 'VIETQR';

export type OrderItemStatus =
  | 'QUEUED'
  | 'COOKING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

export type CookTimeEvaluation = 'ON_TIME' | 'WARNING' | 'LATE';

export type PickupSpeedEvaluation = 'EXCELLENT' | 'NORMAL' | 'SLOW' | 'NO_DATA';

export interface WebPushSubscriptionPayload {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

// ============================================================================
// SUPABASE DATABASE INTERFACE (8 BẢNG + VIEWS + RPC FUNCTIONS)
// ============================================================================

export type Database = {
  public: {
    Tables: {
      zones: {
        Row: {
          id: string;
          name: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      staff_profiles: {
        Row: {
          id: string;
          full_name: string;
          role: StaffRole;
          assigned_zone_id: string | null;
          push_subscription: WebPushSubscriptionPayload | Json | null;
          is_active: boolean;
        };
        Insert: {
          id: string;
          full_name: string;
          role: StaffRole;
          assigned_zone_id?: string | null;
          push_subscription?: WebPushSubscriptionPayload | Json | null;
          is_active?: boolean;
        };
        Update: {
          id?: string;
          full_name?: string;
          role?: StaffRole;
          assigned_zone_id?: string | null;
          push_subscription?: WebPushSubscriptionPayload | Json | null;
          is_active?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_profiles_assigned_zone_id_fkey';
            columns: ['assigned_zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          }
        ];
      };
      tables: {
        Row: {
          id: string;
          table_number: string;
          zone_id: string;
          status: TableStatus;
          current_session_id: string | null;
        };
        Insert: {
          id?: string;
          table_number: string;
          zone_id: string;
          status?: TableStatus;
          current_session_id?: string | null;
        };
        Update: {
          id?: string;
          table_number?: string;
          zone_id?: string;
          status?: TableStatus;
          current_session_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tables_zone_id_fkey';
            columns: ['zone_id'];
            isOneToOne: false;
            referencedRelation: 'zones';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'fk_tables_current_session';
            columns: ['current_session_id'];
            isOneToOne: false;
            referencedRelation: 'table_sessions';
            referencedColumns: ['id'];
          }
        ];
      };
      ingredients: {
        Row: {
          id: string;
          name: string;
          unit: string;
          stock_quantity: number;
          min_threshold: number;
          unit_cost: number;
        };
        Insert: {
          id?: string;
          name: string;
          unit: string;
          stock_quantity?: number;
          min_threshold?: number;
          unit_cost?: number;
        };
        Update: {
          id?: string;
          name?: string;
          unit?: string;
          stock_quantity?: number;
          min_threshold?: number;
          unit_cost?: number;
        };
        Relationships: [];
      };
      inventory_logs: {
        Row: {
          id: string;
          ingredient_id: string;
          type: InventoryLogType;
          quantity_change: number;
          total_cost: number;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ingredient_id: string;
          type: InventoryLogType;
          quantity_change: number;
          total_cost?: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          ingredient_id?: string;
          type?: InventoryLogType;
          quantity_change?: number;
          total_cost?: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'inventory_logs_ingredient_id_fkey';
            columns: ['ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'inventory_logs_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      menu_items: {
        Row: {
          id: string;
          name: string;
          category: MenuCategory;
          station: StationType;
          price: number;
          cost_price: number;
          prep_time_minutes: number;
          image_url: string | null;
          is_available: boolean;
          linked_ingredient_id: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          category: MenuCategory;
          station: StationType;
          price: number;
          cost_price?: number;
          prep_time_minutes?: number;
          image_url?: string | null;
          is_available?: boolean;
          linked_ingredient_id?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          category?: MenuCategory;
          station?: StationType;
          price?: number;
          cost_price?: number;
          prep_time_minutes?: number;
          image_url?: string | null;
          is_available?: boolean;
          linked_ingredient_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'menu_items_linked_ingredient_id_fkey';
            columns: ['linked_ingredient_id'];
            isOneToOne: false;
            referencedRelation: 'ingredients';
            referencedColumns: ['id'];
          }
        ];
      };
      table_sessions: {
        Row: {
          id: string;
          session_token: string;
          session_type: SessionType;
          table_id: string | null;
          assigned_staff_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          status: TableSessionStatus;
          payment_method: PaymentMethod | null;
          payment_code: string | null;
          total_amount: number;
          opened_at: string;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          session_token: string;
          session_type: SessionType;
          table_id?: string | null;
          assigned_staff_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          status: TableSessionStatus;
          payment_method?: PaymentMethod | null;
          payment_code?: string | null;
          total_amount?: number;
          opened_at?: string;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          session_token?: string;
          session_type?: SessionType;
          table_id?: string | null;
          assigned_staff_id?: string | null;
          customer_name?: string | null;
          customer_phone?: string | null;
          status?: TableSessionStatus;
          payment_method?: PaymentMethod | null;
          payment_code?: string | null;
          total_amount?: number;
          opened_at?: string;
          closed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'table_sessions_table_id_fkey';
            columns: ['table_id'];
            isOneToOne: false;
            referencedRelation: 'tables';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'table_sessions_assigned_staff_id_fkey';
            columns: ['assigned_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          }
        ];
      };
      order_items: {
        Row: {
          id: string;
          session_id: string;
          menu_item_id: string;
          quantity: number;
          note: string | null;
          station: StationType;
          status: OrderItemStatus;
          batch_id: string | null;
          unit_price: number;
          unit_cost_price: number;
          served_by_staff_id: string | null;
          created_at: string;
          cooking_started_at: string | null;
          ready_at: string | null;
          served_at: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
        };
        Insert: {
          id?: string;
          session_id: string;
          menu_item_id: string;
          quantity: number;
          note?: string | null;
          station: StationType;
          status: OrderItemStatus;
          batch_id?: string | null;
          unit_price: number;
          unit_cost_price: number;
          served_by_staff_id?: string | null;
          created_at?: string;
          cooking_started_at?: string | null;
          ready_at?: string | null;
          served_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
        };
        Update: {
          id?: string;
          session_id?: string;
          menu_item_id?: string;
          quantity?: number;
          note?: string | null;
          station?: StationType;
          status?: OrderItemStatus;
          batch_id?: string | null;
          unit_price?: number;
          unit_cost_price?: number;
          served_by_staff_id?: string | null;
          created_at?: string;
          cooking_started_at?: string | null;
          ready_at?: string | null;
          served_at?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'order_items_session_id_fkey';
            columns: ['session_id'];
            isOneToOne: false;
            referencedRelation: 'table_sessions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_menu_item_id_fkey';
            columns: ['menu_item_id'];
            isOneToOne: false;
            referencedRelation: 'menu_items';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_served_by_staff_id_fkey';
            columns: ['served_by_staff_id'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'order_items_cancelled_by_fkey';
            columns: ['cancelled_by'];
            isOneToOne: false;
            referencedRelation: 'staff_profiles';
            referencedColumns: ['id'];
          }
        ];
      };
    };
    Views: {
      vw_kpi_financial_summary: {
        Row: {
          gross_revenue: number;
          cash_revenue: number;
          vietqr_revenue: number;
          dine_in_revenue: number;
          takeaway_revenue: number;
          closed_sessions_count: number;
          total_cogs: number;
          total_wastage_cost: number;
          net_profit: number;
        };
        Relationships: [];
      };
      vw_kpi_peak_hours: {
        Row: {
          hour_of_day: number;
          total_orders_count: number;
          total_items_quantity: number;
          total_order_value: number;
        };
        Relationships: [];
      };
      vw_kpi_menu_analytics: {
        Row: {
          menu_item_id: string;
          name: string;
          category: MenuCategory;
          station: StationType;
          is_available: boolean;
          total_quantity_sold: number;
          gross_revenue: number;
          total_cogs: number;
          gross_profit: number;
        };
        Relationships: [];
      };
      vw_kpi_kitchen_performance: {
        Row: {
          total_cooked_items: number;
          batch_cooked_items: number;
          avg_queue_wait_minutes: number;
          avg_actual_cook_minutes: number;
          avg_standard_prep_minutes: number;
          cook_time_evaluation: CookTimeEvaluation;
          batch_cooking_efficiency_pct: number;
          slow_cancelled_count: number;
        };
        Relationships: [];
      };
      vw_kpi_waitstaff_performance: {
        Row: {
          staff_id: string;
          full_name: string;
          role: StaffRole;
          assigned_zone_id: string | null;
          is_active: boolean;
          tables_opened_count: number;
          managed_tables_revenue: number;
          active_serving_count: number;
          avg_pickup_speed_seconds: number;
          pickup_speed_evaluation: PickupSpeedEvaluation;
        };
        Relationships: [];
      };
    };
    Functions: {
      fn_get_financial_kpi: {
        Args: {
          p_start_date?: string;
          p_end_date?: string;
        };
        Returns: {
          gross_revenue: number;
          cash_revenue: number;
          vietqr_revenue: number;
          dine_in_revenue: number;
          takeaway_revenue: number;
          closed_sessions_count: number;
          total_cogs: number;
          total_wastage_cost: number;
          net_profit: number;
        }[];
      };
      fn_get_menu_kpi: {
        Args: {
          p_start_date?: string;
          p_end_date?: string;
        };
        Returns: {
          menu_item_id: string;
          name: string;
          category: MenuCategory;
          station: StationType;
          is_available: boolean;
          total_quantity_sold: number;
          gross_revenue: number;
          total_cogs: number;
          gross_profit: number;
        }[];
      };
      fn_get_kitchen_kpi: {
        Args: {
          p_start_date?: string;
          p_end_date?: string;
        };
        Returns: {
          total_cooked_items: number;
          batch_cooked_items: number;
          avg_queue_wait_minutes: number;
          avg_actual_cook_minutes: number;
          avg_standard_prep_minutes: number;
          cook_time_evaluation: CookTimeEvaluation;
          batch_cooking_efficiency_pct: number;
          slow_cancelled_count: number;
        }[];
      };
      fn_get_waitstaff_kpi: {
        Args: {
          p_start_date?: string;
          p_end_date?: string;
        };
        Returns: {
          staff_id: string;
          full_name: string;
          role: StaffRole;
          assigned_zone_id: string | null;
          is_active: boolean;
          tables_opened_count: number;
          managed_tables_revenue: number;
          active_serving_count: number;
          avg_pickup_speed_seconds: number;
          pickup_speed_evaluation: PickupSpeedEvaluation;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

// ============================================================================
// CONVENIENCE ROW / INSERT / UPDATE ALIASES
// ============================================================================

export type ZoneRow = Database['public']['Tables']['zones']['Row'];
export type ZoneInsert = Database['public']['Tables']['zones']['Insert'];
export type ZoneUpdate = Database['public']['Tables']['zones']['Update'];

export type StaffProfileRow = Database['public']['Tables']['staff_profiles']['Row'];
export type StaffProfileInsert = Database['public']['Tables']['staff_profiles']['Insert'];
export type StaffProfileUpdate = Database['public']['Tables']['staff_profiles']['Update'];

export type TableRow = Database['public']['Tables']['tables']['Row'];
export type TableInsert = Database['public']['Tables']['tables']['Insert'];
export type TableUpdate = Database['public']['Tables']['tables']['Update'];

export type IngredientRow = Database['public']['Tables']['ingredients']['Row'];
export type IngredientInsert = Database['public']['Tables']['ingredients']['Insert'];
export type IngredientUpdate = Database['public']['Tables']['ingredients']['Update'];

export type InventoryLogRow = Database['public']['Tables']['inventory_logs']['Row'];
export type InventoryLogInsert = Database['public']['Tables']['inventory_logs']['Insert'];
export type InventoryLogUpdate = Database['public']['Tables']['inventory_logs']['Update'];

export type MenuItemRow = Database['public']['Tables']['menu_items']['Row'];
export type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert'];
export type MenuItemUpdate = Database['public']['Tables']['menu_items']['Update'];

export type TableSessionRow = Database['public']['Tables']['table_sessions']['Row'];
export type TableSessionInsert = Database['public']['Tables']['table_sessions']['Insert'];
export type TableSessionUpdate = Database['public']['Tables']['table_sessions']['Update'];

export type OrderItemRow = Database['public']['Tables']['order_items']['Row'];
export type OrderItemInsert = Database['public']['Tables']['order_items']['Insert'];
export type OrderItemUpdate = Database['public']['Tables']['order_items']['Update'];

export type KpiFinancialSummary = Database['public']['Views']['vw_kpi_financial_summary']['Row'];
export type KpiPeakHour = Database['public']['Views']['vw_kpi_peak_hours']['Row'];
export type KpiMenuAnalytics = Database['public']['Views']['vw_kpi_menu_analytics']['Row'];
export type KpiKitchenPerformance = Database['public']['Views']['vw_kpi_kitchen_performance']['Row'];
export type KpiWaitstaffPerformance = Database['public']['Views']['vw_kpi_waitstaff_performance']['Row'];
