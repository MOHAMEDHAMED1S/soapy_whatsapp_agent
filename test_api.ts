import { apiService } from './src/services/ApiService';

async function test() {
  console.log('Testing apiService.getProducts()');
  
  // Try directly searching for whatsapp only product by doing a search
  const result = await apiService.getProducts({ per_page: 100 });
  
  if (result.success) {
    const data = result.data.data; // The products array
    console.log(`Found ${data.length} products`);
    
    // Check if we got WhatsApp only products
    const whatsappOnly = data.filter((p: any) => p.channel_whatsapp === true && p.channel_web === false);
    console.log(`Found ${whatsappOnly.length} whatsapp-only products`);
    whatsappOnly.forEach((p: any) => {
      console.log(`- [${p.id}] ${p.name}`);
    });
  } else {
    console.error('API failed', result);
  }
}

test().catch(console.error);
