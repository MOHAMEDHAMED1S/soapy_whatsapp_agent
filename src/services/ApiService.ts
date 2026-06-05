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
  OrderTrackingResponse,
  ValidateDiscountCodeRequest,
  ValidateDiscountCodeResponse,
  CalculateShippingRequest,
  CalculateShippingResponse,
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
        'X-Client-Platform': 'whatsapp',
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
        // Map products using our mapper and filter out of stock items
        const mappedProducts = apiData.data
          .map((p: any) => this.mapApiProductToProduct(p))
          // Filter: Must be in stock AND (if quantity is provided) quantity > 0
          .filter((p: Product) => p.is_in_stock !== false && (p.stock_quantity === undefined || p.stock_quantity > 0));

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

  // Get shipping cost (legacy - for backward compatibility)
  async getShippingCost(): Promise<ApiResponse<ShippingCostResponse>> {
    try {
      const response = await this.client.get<ApiResponse<ShippingCostResponse>>('/shipping/cost');
      return response.data;
    } catch (error: any) {
      logger.error('Error fetching shipping cost:', error);
      throw new Error(`Failed to fetch shipping cost: ${error.message}`);
    }
  }

  // Calculate shipping cost based on products, quantities, and country
  async calculateShippingCost(request: CalculateShippingRequest): Promise<ApiResponse<CalculateShippingResponse>> {
    try {
      logger.debug('Calculate shipping cost request:', JSON.stringify(request, null, 2));

      const response = await this.client.post<ApiResponse<CalculateShippingResponse>>(
        '/shipping/calculate',
        request
      );

      logger.debug('Calculate shipping cost response:', {
        status: response.status,
        data: response.data,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Error calculating shipping cost:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      // If API returns error response with data, return it
      if (error.response?.data) {
        return error.response.data;
      }

      // Otherwise, throw error
      const errorMessage = error.response?.data?.message || error.message || 'Failed to calculate shipping cost';
      throw new Error(errorMessage);
    }
  }

  // Validate discount code
  async validateDiscountCode(request: ValidateDiscountCodeRequest): Promise<ApiResponse<ValidateDiscountCodeResponse>> {
    try {
      const response = await this.client.post<ApiResponse<ValidateDiscountCodeResponse>>(
        '/checkout/validate-discount',
        request
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error validating discount code:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      throw new Error(`Failed to validate discount code: ${errorMessage}`);
    }
  }

  // Calculate order total
  async calculateTotal(request: CalculateTotalRequest): Promise<ApiResponse<OrderTotal>> {
    try {
      logger.debug('Calculate total request:', JSON.stringify(request, null, 2));
      const response = await this.client.post<ApiResponse<OrderTotal>>(
        '/checkout/calculate-total',
        request
      );

      logger.debug('Calculate total raw response:', {
        status: response.status,
        data: response.data,
        dataType: typeof response.data,
        keys: response.data ? Object.keys(response.data) : [],
      });

      // Validate response structure
      if (!response.data) {
        logger.error('API returned empty response data');
        return {
          success: false,
          message: 'API returned empty response',
          data: {} as OrderTotal,
        };
      }

      // Handle different response structures
      const responseData = response.data as any;

      // Case 1: Standard ApiResponse format { success, data, message }
      if (responseData.success !== undefined) {
        // If data field exists, use it
        if (responseData.data) {
          return responseData as ApiResponse<OrderTotal>;
        }

        // If data field doesn't exist but response has OrderTotal fields directly
        // Check if response.data itself is OrderTotal (flat structure)
        if (responseData.subtotal !== undefined || responseData.total !== undefined) {
          logger.info('API returned flat OrderTotal structure, wrapping in ApiResponse');
          return {
            success: true,
            data: responseData as OrderTotal,
            message: responseData.message || 'Order total calculated successfully',
          };
        }

        // If success is true but no data, log error
        if (responseData.success && !responseData.data) {
          logger.error('API returned success but no data field:', JSON.stringify(responseData, null, 2));
          return {
            success: false,
            message: responseData.message || 'API returned success but no data',
            data: {} as OrderTotal,
          };
        }
      }

      // Case 2: Direct OrderTotal structure (no wrapper)
      if (responseData.subtotal !== undefined || responseData.total !== undefined) {
        logger.info('API returned direct OrderTotal structure, wrapping in ApiResponse');
        return {
          success: true,
          data: responseData as OrderTotal,
          message: 'Order total calculated successfully',
        };
      }

      // Unknown structure
      logger.error('Unknown API response structure:', JSON.stringify(responseData, null, 2));
      return {
        success: false,
        message: 'Unknown API response structure',
        data: {} as OrderTotal,
      };
    } catch (error: any) {
      logger.error('Error calculating total:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
      });

      // If API returns error response with data, return it
      if (error.response?.data) {
        return error.response.data;
      }

      // Otherwise, return error response format
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to calculate total',
        errors: error.response?.data?.errors,
        data: {} as OrderTotal,
      };
    }
  }

  // Create order
  async createOrder(request: CreateOrderRequest): Promise<ApiResponse<CreateOrderResponse>> {
    try {
      // Automatically add from_whatsapp flag
      const orderPayload = {
        ...request,
        from_whatsapp: true
      };

      const response = await this.client.post<ApiResponse<CreateOrderResponse>>(
        '/checkout/create-order',
        orderPayload
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error creating order:', error);
      throw new Error(`Failed to create order: ${error.message}`);
    }
  }

  // Create order (Safe variant that does not throw)
  async createOrderSafe(request: CreateOrderRequest): Promise<ApiResponse<CreateOrderResponse>> {
    try {
      const orderPayload = {
        ...request,
        from_whatsapp: true
      };
      const response = await this.client.post<ApiResponse<CreateOrderResponse>>(
        '/checkout/create-order',
        orderPayload
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error creating order:', error.message);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to create order',
        errors: error.response?.data?.errors,
        data: {} as CreateOrderResponse,
      };
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

  // Initiate payment (Safe variant that does not throw)
  async initiatePaymentSafe(
    request: InitiatePaymentRequest
  ): Promise<ApiResponse<InitiatePaymentResponse>> {
    try {
      const response = await this.client.post<ApiResponse<InitiatePaymentResponse>>(
        '/payments/initiate',
        request
      );
      return response.data;
    } catch (error: any) {
      logger.error('Error initiating payment:', error.message);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Failed to initiate payment',
        errors: error.response?.data?.errors,
        data: {} as InitiatePaymentResponse,
      };
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

  // Track order by order number
  async trackOrder(orderNumber: string | number): Promise<ApiResponse<OrderTrackingResponse>> {
    try {
      const response = await this.client.get<ApiResponse<OrderTrackingResponse>>(
        `/orders/${orderNumber}/track`
      );
      return response.data;
    } catch (error: any) {
      logger.error(`Error tracking order ${orderNumber}:`, error);
      const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
      throw new Error(`Failed to track order: ${errorMessage}`);
    }
  }
}

// Export singleton instance
export const apiService = new ApiService();

