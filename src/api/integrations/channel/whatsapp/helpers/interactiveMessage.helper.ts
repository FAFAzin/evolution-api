import { Button, KeyType } from '@api/dto/sendMessage.dto';
import { BinaryNode } from 'baileys';

export function buildInteractiveBizNode(): BinaryNode {
  return {
    tag: 'biz',
    attrs: {},
    content: [
      {
        tag: 'interactive',
        attrs: { type: 'native_flow', v: '1' },
        content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
      },
    ],
  };
}

/**
 * Nó `biz` FLAT para nativeFlow de pagamento — o formato que a W-API usa no wire
 * (`<biz native_flow_name='payment_info'/>`), capturado 2026-07-03. O formato
 * aninhado (`<biz><interactive><native_flow name='payment_info'/>`) dispara o gate
 * 473 do servidor; o flat passa como stanza `type='text'` e renderiza no
 * destinatário quando enviado de uma conta Business. Ver docs/brain/pix-discard.md.
 */
export function buildPaymentBizNode(): BinaryNode {
  return { tag: 'biz', attrs: { native_flow_name: 'payment_info' } };
}

/**
 * Nó `bot` que o WA Web >= 2.3000.1040549582 (jun/2026) passou a exigir para
 * renderizar interativas/listas em chats 1:1 (InfiniteAPI#494). Deve vir DEPOIS
 * do `<biz>` (ordem biz→bot, igual ao cliente WA Web oficial) e NUNCA em grupos.
 * Um teste anterior (2026-07-03) deu ack 451 "commerce features disabled" — mas
 * era conta COMUM e ordem invertida (bot→biz). Reintroduzido para validar em
 * conta Business com a ordem correta. Ver docs/brain/sendlist-discard.md.
 */
export function buildBotNode(): BinaryNode {
  return { tag: 'bot', attrs: { biz_bot: '1' } };
}

/**
 * Biz node específico para `listMessage` legado.
 * Necessário para o WhatsApp Web/Desktop renderizar a lista — o moderno
 * (`interactiveMessage` + `single_select`) não é renderizado no Web.
 */
export function buildListBizNode(): BinaryNode {
  return {
    tag: 'biz',
    attrs: {},
    content: [{ tag: 'list', attrs: { type: 'product_list', v: '2' } }],
  };
}

type NativeFlowButton = { name: string; buttonParamsJson: string };

type NativeFlowDeps = {
  generateRandomId: () => string;
  mapKeyType: Map<KeyType, string>;
};

export function toNativeFlowButton(button: Button, deps: NativeFlowDeps): NativeFlowButton {
  const displayText = button.displayText ?? '';

  switch (button.type) {
    case 'url':
      return {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: displayText,
          url: button.url,
          merchant_url: button.url,
        }),
      };

    case 'call':
      return {
        name: 'cta_call',
        buttonParamsJson: JSON.stringify({
          display_text: displayText,
          phone_number: button.phoneNumber,
        }),
      };

    case 'copy':
      return {
        name: 'cta_copy',
        buttonParamsJson: JSON.stringify({
          display_text: displayText,
          copy_code: button.copyCode,
        }),
      };

    case 'reply':
      return {
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({
          display_text: displayText,
          id: button.id ?? deps.generateRandomId(),
        }),
      };

    case 'pix':
      return {
        name: 'payment_info',
        buttonParamsJson: JSON.stringify({
          currency: button.currency,
          total_amount: { value: 0, offset: 100 },
          reference_id: deps.generateRandomId(),
          type: 'physical-goods',
          order: {
            status: 'pending',
            subtotal: { value: 0, offset: 100 },
            order_type: 'ORDER',
            items: [
              { name: '', amount: { value: 0, offset: 100 }, quantity: 0, sale_amount: { value: 0, offset: 100 } },
            ],
          },
          payment_settings: [
            {
              type: 'pix_static_code',
              pix_static_code: {
                merchant_name: button.name,
                key: button.key,
                key_type: deps.mapKeyType.get(button.keyType),
              },
            },
          ],
          share_payment_status: false,
        }),
      };

    default:
      throw new Error(`Unsupported button type: ${(button as Button).type}`);
  }
}

type ListSection = {
  title: string;
  rows: Array<{ title: string; description?: string; rowId: string }>;
};

export function buildSingleSelectButton(buttonText: string, sections: ListSection[]): NativeFlowButton {
  const buttonParams = {
    title: buttonText || ' ',
    sections: (sections || []).map((section) => ({
      title: section.title || ' ',
      highlight_label: '',
      rows: (section.rows || []).map((row, index) => {
        const rowTitle = row.title || ' ';
        return {
          header: rowTitle,
          title: rowTitle,
          description: row.description || ' ',
          id: row.rowId || `row_${index}`,
        };
      }),
    })),
  };

  return {
    name: 'single_select',
    buttonParamsJson: JSON.stringify(buttonParams),
  };
}
