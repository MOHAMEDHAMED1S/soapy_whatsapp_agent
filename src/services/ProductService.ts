import { apiService } from './ApiService';
import { logger } from '../utils/logger';
import { Product, ProductCatalog, ProductSearchResult } from '../types/product.types';
import { GetProductsParams } from '../types/api.types';

export class ProductService {
  private catalog: ProductCatalog | null = null;
  private lastUpdateTime: Date | null = null;
  private readonly CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

  // Get all products with caching
  async getAllProducts(forceRefresh: boolean = false): Promise<Product[]> {
    try {
      if (!forceRefresh && this.catalog && this.lastUpdateTime) {
        const cacheAge = Date.now() - this.lastUpdateTime.getTime();
        if (cacheAge < this.CACHE_DURATION) {
          logger.debug('Returning cached products');
          return this.catalog.products;
        }
      }

      logger.info('Fetching products from API...');
      const response = await apiService.getProducts({ page: 1, per_page: 1000 });
      
      if (response.success && response.data) {
        // Use products alias if available, otherwise use data array
        const products = response.data.products || response.data.data || [];
        
        if (products.length > 0) {
          this.catalog = {
            products: products,
            lastUpdated: new Date(),
          };
          this.lastUpdateTime = new Date();
          logger.info(`Loaded ${products.length} products`);
          return products;
        }
      }

      throw new Error(response.message || 'Failed to fetch products');
    } catch (error: any) {
      const errorMsg = error.message || 'Unknown error';
      logger.error('Error fetching all products:', errorMsg);
      // Return cached products if available, even if expired
      if (this.catalog) {
        logger.warn('Returning stale cached products due to API error');
        return this.catalog.products;
      }
      // Don't throw error, return empty array to allow bot to continue
      logger.warn('No products available. Bot will continue but product features may be limited.');
      return [];
    }
  }

  // Search products
  async searchProducts(query: string, category?: string): Promise<ProductSearchResult> {
    try {
      const params: GetProductsParams = {
        search: query,
        page: 1,
        per_page: 50,
      };

      if (category) {
        params.category = category;
      }

      const response = await apiService.getProducts(params);
      
      if (response.success && response.data) {
        // Use products alias if available, otherwise use data array
        const products = response.data.products || response.data.data || [];
        return {
          products: products,
          total: response.data.total,
          page: response.data.current_page,
          hasMore: response.data.hasMore !== undefined ? response.data.hasMore : (response.data.next_page_url !== null),
        };
      }

      throw new Error('Failed to search products');
    } catch (error) {
      logger.error('Error searching products:', error);
      throw error;
    }
  }

  // Get product by ID
  async getProductById(id: number): Promise<Product | null> {
    try {
      // First check cache
      if (this.catalog) {
        const product = this.catalog.products.find(p => p.id === id);
        if (product) {
          return product;
        }
      }

      // Fetch from API
      const response = await apiService.getProductById(id);
      if (response.success && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      logger.error(`Error fetching product ${id}:`, error);
      return null;
    }
  }

  // Get product by slug
  async getProductBySlug(slug: string): Promise<Product | null> {
    try {
      // First check cache
      if (this.catalog) {
        const product = this.catalog.products.find(p => p.slug === slug);
        if (product) {
          return product;
        }
      }

      // Fetch from API
      const response = await apiService.getProductBySlug(slug);
      if (response.success && response.data) {
        return response.data;
      }

      return null;
    } catch (error) {
      logger.error(`Error fetching product ${slug}:`, error);
      return null;
    }
  }

  // Get featured products
  async getFeaturedProducts(): Promise<Product[]> {
    try {
      const response = await apiService.getFeaturedProducts();
      if (response.success && response.data) {
        return response.data;
      }
      return [];
    } catch (error) {
      logger.error('Error fetching featured products:', error);
      return [];
    }
  }

  // Get products by category
  async getProductsByCategory(categorySlug: string): Promise<Product[]> {
    try {
      const response = await apiService.getProducts({
        category: categorySlug,
        page: 1,
        per_page: 100,
      });

      if (response.success && response.data.products) {
        return response.data.products;
      }

      return [];
    } catch (error) {
      logger.error(`Error fetching products for category ${categorySlug}:`, error);
      return [];
    }
  }

  // Get catalog (cached products)
  getCatalog(): ProductCatalog | null {
    return this.catalog;
  }

  // Clear cache
  clearCache(): void {
    this.catalog = null;
    this.lastUpdateTime = null;
    logger.info('Product cache cleared');
  }

  // Initialize catalog on startup
  async initialize(): Promise<void> {
    try {
      const products = await this.getAllProducts(true);
      if (products.length > 0) {
        logger.info(`Product catalog initialized with ${products.length} products`);
      } else {
        logger.warn('Product catalog initialized but no products found. API may be unavailable.');
      }
    } catch (error: any) {
      logger.error('Error initializing product catalog:', error.message || error);
      logger.warn('Bot will continue but product features may be limited.');
    }
  }

  // Format product list for display
  formatProductList(products: Product[]): string {
    if (products.length === 0) {
      return 'لا توجد منتجات متاحة.';
    }

    let message = 'المنتجات المتاحة:\n\n';
    products.slice(0, 10).forEach((product, index) => {
      // Get product name - API uses 'title' field
      const name = product.title || product.name_ar || product.name_en || product.name || `منتج ${product.id}`;
      
      // Get price - API returns price as string, but we also have numeric fields
      let price: number | string = 0;
      if (typeof product.price === 'string') {
        price = parseFloat(product.price) || 0;
      } else if (typeof product.price === 'number') {
        price = product.price;
      } else {
        price = product.sale_price || product.discounted_price || 0;
      }
      
      message += `${index + 1}. ${name}\n`;
      message += `   السعر: ${price} ${product.currency || 'د.ك'}\n`;
      
      // Get description - API uses 'description' field (Arabic)
      if (product.description || product.description_ar || product.description_en) {
        const desc = (product.description || product.description_ar || product.description_en || '').substring(0, 50);
        if (desc && desc.trim()) {
          message += `   ${desc}...\n`;
        }
      }
      
      message += '\n';
    });

    if (products.length > 10) {
      message += `\nو ${products.length - 10} منتج آخر...`;
    }

    return message;
  }

  // Format single product for display
  formatProduct(product: Product): string {
    // Get product name - API uses 'title' field
    const name = product.title || product.name_ar || product.name_en || product.name || `منتج ${product.id}`;
    const description = product.description || product.description_ar || product.description_en || '';
    
    // Get price - handle both string and number
    let price: number | string = 0;
    if (typeof product.price === 'string') {
      price = parseFloat(product.price) || 0;
    } else if (typeof product.price === 'number') {
      price = product.price;
    } else {
      price = product.sale_price || product.discounted_price || 0;
    }
    
    const currency = product.currency || 'د.ك';
    const originalPrice = product.has_discount && product.price_before_discount 
      ? product.price_before_discount 
      : null;

    let message = `${name}\n\n`;
    
    if (description && description.trim()) {
      message += `${description.substring(0, 300)}${description.length > 300 ? '...' : ''}\n\n`;
    }

    if (originalPrice && product.has_discount) {
      message += `السعر: ${price} ${currency} (كان ${originalPrice} ${currency})\n`;
      if (product.discount_percentage) {
        message += `خصم ${product.discount_percentage}%\n`;
      }
    } else {
      message += `السعر: ${price} ${currency}\n`;
    }

    const stock = product.stock_quantity || product.stock;
    if (stock !== undefined) {
      if (stock > 0) {
        message += `المخزون: ${stock}`;
        if (product.is_low_stock) {
          message += ' (مخزون منخفض)';
        }
        message += '\n';
      } else {
        message += `غير متوفر\n`;
      }
    } else if (product.in_stock !== undefined) {
      message += product.in_stock ? 'متوفر\n' : 'غير متوفر\n';
    }

    // Add product ID for ordering
    message += `\nرقم المنتج: ${product.id}`;

    return message;
  }
}

// Export singleton instance
export const productService = new ProductService();

