// Product Types - Based on actual API response
export interface Product {
  id: number;
  title: string; // API uses 'title' instead of 'name'
  slug: string;
  description?: string; // API uses 'description' (Arabic)
  short_description?: string;
  price: string; // API returns price as string (e.g., "12.000")
  currency: string; // e.g., "KWD"
  discounted_price?: number; // Calculated discounted price
  price_before_discount?: number;
  has_discount?: boolean;
  discount_percentage?: number | null;
  is_available: boolean;
  has_inventory: boolean;
  stock_quantity?: number;
  low_stock_threshold?: number;
  stock_last_updated_at?: string;
  is_in_stock?: boolean;
  is_low_stock?: boolean;
  category_id?: number;
  images?: string[]; // Array of image URLs
  meta?: {
    weight?: string | null;
    skin_type?: string | null;
    dimensions?: string | null;
    ingredients?: string | null;
  };
  category?: {
    id: number;
    name: string;
    description?: string;
    is_active: number;
    sort_order: number;
    meta_title?: string | null;
    meta_description?: string | null;
    image?: string;
    slug: string;
    parent_id?: number | null;
    created_at?: string;
    updated_at?: string;
  };
  created_at?: string;
  updated_at?: string;
  
  // Compatibility fields (for backward compatibility)
  name?: string; // Alias for title
  name_ar?: string; // Alias for title
  name_en?: string; // Alias for title
  description_ar?: string; // Alias for description
  description_en?: string; // Alias for description
  sale_price?: number; // Computed from discounted_price or price
  image?: string; // First image from images array
  category_slug?: string; // From category.slug
  stock?: number; // Alias for stock_quantity
  in_stock?: boolean; // Alias for is_in_stock
  featured?: boolean; // Can be computed or added
}

export interface ProductCatalog {
  products: Product[];
  lastUpdated: Date;
}

export interface ProductSearchResult {
  products: Product[];
  total: number;
  page: number;
  hasMore: boolean;
}

