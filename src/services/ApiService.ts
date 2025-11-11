import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import {
  ApiResponse,
  GetProductsParams,
  ProductsResponse,
  ShippingCostResponse,
  CalculateTotalRequest,
  OrderTotal,
  CreateOrderRequest,
  CreateOrderResponse,
  PaymentMethodsResponse,
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  PaymentStatusResponse,
} from '../types/api.types';
import { Product } from '../types/product.types';

export class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: config.api.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('API Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('API Response Error:', error.response?.data || error.message);
        return Promise.reject(error);
      }
    );
  }

  // Map API product to our Product interface
  private mapApiProductToProduct(apiProduct: any): Product {
    const priceNum = parseFloat(apiProduct.price || '0');
    const discountedPrice = apiProduct.discounted_price || priceNum;
    
    return {
      ...apiProduct,
      // Keep original price as string (as API returns it)
      price: apiProduct.price, // Keep as string
      // Compatibility fields
      name: apiProduct.title,
      name_ar: apiProduct.title,
      name_en: apiProduct.title,
      description_ar: apiProduct.description,
      description_en: apiProduct.description,
      sale_price: discountedPrice, // Numeric price for calculations
      image: apiProduct.images && apiProduct.images.length > 0 ? apiProduct.images[0] : undefined,
      category_slug: apiProduct.category?.slug,
      stock: apiProduct.stock_quantity,
      in_stock: apiProduct.is_in_stock,
      featured: false, // Can be set based on business logic
    };
  }

  // Get all products
  async getProducts(params: GetProductsParams = {}): Promise<ApiResponse<ProductsResponse>> {
    try {
      const response = await this.client.get<any>('/products', {
        params,
      });
      
      // API returns: { success: true, data: { data: [...], current_page: ..., ... }, message: "..." }
      const apiData = response.data.data;
      
      if (response.data.success && apiData && Array.isArray(apiData.data)) {
        // Map products using our mapper
        const mappedProducts = apiData.data.map((p: any) => this.mapApiProductToProduct(p));
        
        // Create ProductsResponse structure
        const productsResponse: ProductsResponse = {
          data: mappedProducts,
          current_page: apiData.current_page,
          last_page: apiData.last_page,
          total: apiData.total,
          per_page: apiData.per_page,
          from: apiData.from,
          to: apiData.to,
          first_page_url: apiData.first_page_url,
          last_page_url: apiData.last_page_url,
          next_page_url: apiData.next_page_url,
          prev_page_url: apiData.prev_page_url,
          path: apiData.path,
          links: apiData.links,
          hasMore: apiData.next_page_url !== null,
          products: mappedProducts, // Alias for backward compatibility
        };
        
        return {
          success: response.data.success,
          data: productsResponse,
          message: response.data.message,
          errors: response.data.errors,
        };
      }
      
      // Fallback: return as-is if structure is different
      logger.warn('Unexpected API response structure for products');
      return response.data;
    } catch (error: any) {
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      const errorDetails = error.response?.data || error;
      logger.error('Error fetching products:', {
        message: errorMessage,
        status: error.response?.status,
        data: errorDetails,
      });
      throw new Error(`Failed to fetch products: ${errorMessage}`);
    }
  }

  // Get single product by ID
  async getProductById(id: string | number): Promise<ApiResponse<Product>> {
    try {
      const response = await this.client.get<any>(`/products/${id}`);
      
      // API returns: { success: true, data: {...}, message: "..." }
      if (response.data.success && response.data.data) {
        return {
          success: response.data.success,
          data: this.mapApiProductToProduct(response.data.data),
          message: response.data.message,
          errors: response.data.errors,
        };
      }
      
      return response.data;
    } catch (error: any) {
      logger.error(`Error fetching product ${id}:`, error);
      throw new Error(`Failed to fetch product: ${error.message}`);
    }
  }

  // Get single product by slug
  async getProductBySlug(slug: string): Promise<ApiResponse<Product>> {
    try {
      const response = await this.client.get<ApiResponse<Product>>(`/products/${slug}`);
      return response.data;
    } catch (error: any) {
      logger.error(`Error fetching product ${slug}:`, error);
      throw new Error(`Failed to fetch product: ${error.message}`);
    }
  }

  // Get featured products
  async getFeaturedProducts(): Promise<ApiResponse<Product[]>> {
    try {
      const response = await this.client.get<any>('/products/featured');
      
      // API returns: { success: true, data: [...], message: "..." }
      if (response.data.success && Array.isArray(response.data.data)) {
        const mappedProducts = response.data.data.map((p: any) => this.mapApiProductToProduct(p));
        
        return {
          success: response.data.success,
          data: mappedProducts,
          message: response.data.message,
          errors: response.data.errors,
        };
      }
      
      return response.data;
    } catch (error: any) {
      logger.error('Error fetching featured products:', error);
      throw new Error(`Failed to fetch featured products: ${error.message}`);
    }
  }

  // Get shipping cost
  async getShippingCost(): Promise<ApiResponse<ShippingCostResponse>> {
    try {
      const response = await this.client.get<ApiResponse<ShippingCostResponse>>('/shipping/cost');
      return response.data;
    } catch (error: any) {
      logger.error('Error fetching shipping cost:', error);
      throw new Error(`Failed to fetch shipping cost: ${error.message}`);
    }
  }

  // Calculate order total
  async calculateTotal(request: CalculateTotalRequest): Promise<ApiResponse<OrderTotal>> {
    try {
      const response = await this.client.post<ApiResponse<OrderTotal>>(
        '/checkout/calculate-total',
        request
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error calculating total:', error);
      throw new Error(`Failed to calculate total: ${error.message}`);
    }
  }

  // Create order
  async createOrder(request: CreateOrderRequest): Promise<ApiResponse<CreateOrderResponse>> {
    try {
      const response = await this.client.post<ApiResponse<CreateOrderResponse>>(
        '/checkout/create-order',
        request
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error creating order:', error);
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  // Get payment methods
  async getPaymentMethods(): Promise<ApiResponse<PaymentMethodsResponse>> {
    try {
      const response = await this.client.get<ApiResponse<PaymentMethodsResponse>>(
        '/payments/methods'
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error fetching payment methods:', error);
      throw new Error(`Failed to fetch payment methods: ${error.message}`);
    }
  }

  // Initiate payment
  async initiatePayment(
    request: InitiatePaymentRequest
  ): Promise<ApiResponse<InitiatePaymentResponse>> {
    try {
      const response = await this.client.post<ApiResponse<InitiatePaymentResponse>>(
        '/payments/initiate',
        request
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error initiating payment:', error);
      throw new Error(`Failed to initiate payment: ${error.message}`);
    }
  }

  // Get payment status
  async getPaymentStatus(orderId: number): Promise<ApiResponse<PaymentStatusResponse>> {
    try {
      const response = await this.client.get<ApiResponse<PaymentStatusResponse>>(
        '/payments/status',
        {
          params: { order_id: orderId },
        }
      );
      return response.data;
    } catch (error: any) {
      logger.error(`Error fetching payment status for order ${orderId}:`, error);
      throw new Error(`Failed to fetch payment status: ${error.message}`);
    }
  }
}

// Export singleton instance
export const apiService = new ApiService();

