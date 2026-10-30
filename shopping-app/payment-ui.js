import { api, notify } from './ui.js';
let scriptPromise;
function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('Hosted payment checkout is unavailable'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}
export async function payOrder(orderId) {
  const session = await api('/api/orders/' + orderId + '/payment-session', 'POST', {});
  await loadCheckout();
  const checkout = new window.Razorpay({
    key: session.keyId,
    order_id: session.providerOrderId,
    amount: session.amountPaise,
    currency: 'INR',
    name: 'NovaCart',
    description: 'Order payment',
    handler: async () => {
      notify('Provider response received. Awaiting verified server confirmation.');
      for (let n = 0; n < 10; n++) {
        const order = await api('/api/orders/' + orderId);
        if (order.paymentStatus === 'PAID') {
          notify('The server has confirmed payment. Refresh your order history.');
          return;
        }
        if (['CANCELLED', 'FAILED'].includes(order.status) || order.paymentStatus === 'FAILED') {
          notify('Payment is not confirmed. Review the order before another attempt.');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      notify('Payment confirmation is still pending. Check your order history or contact support.');
    },
  });
  checkout.on('payment.failed', () =>
    notify('The provider reported failure. Review the order status before retrying.'),
  );
  checkout.open();
}
