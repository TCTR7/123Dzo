'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MenuCategory, StationType } from '@/types/database.types';

export interface CartItem {
  menu_item_id: string;
  name: string;
  category: MenuCategory;
  station: StationType;
  unit_price: number;
  unit_cost_price: number;
  image_url: string | null;
  quantity: number;
  note: string;
}

interface CartState {
  sessionToken: string | null;
  items: CartItem[];
  submissionTimestamps: number[];
  setSessionToken: (token: string) => void;
  addItem: (
    item: Omit<CartItem, 'quantity' | 'note'> & {
      quantity?: number;
      note?: string;
    }
  ) => void;
  updateQuantity: (menuItemId: string, quantity: number, note?: string) => void;
  updateNote: (menuItemId: string, note: string) => void;
  removeItem: (menuItemId: string, note?: string) => void;
  clearCart: () => void;
  getTotalQuantity: () => number;
  getTotalAmount: () => number;
  canSubmitOrder: () => boolean;
  recordOrderSubmission: () => void;
}

const RATE_LIMIT_WINDOW_MS = 10_000; // 10 giây
const MAX_SUBMISSIONS_PER_WINDOW = 2; // Tối đa 2 lượt đặt món / 10 giây (Mục 6.5 PRD_SPEC.md)

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      sessionToken: null,
      items: [],
      submissionTimestamps: [],

      setSessionToken: (token: string) => {
        const currentToken = get().sessionToken;
        if (currentToken && currentToken !== token) {
          // Nếu khách quét sang mã QR của phiên bàn mới, làm sạch giỏ hàng cũ
          set({
            sessionToken: token,
            items: [],
            submissionTimestamps: [],
          });
        } else if (!currentToken) {
          set({ sessionToken: token });
        }
      },

      addItem: (incoming) => {
        const addQty = incoming.quantity ?? 1;
        const normalizedNote = (incoming.note ?? '').trim();
        if (addQty <= 0) return;

        set((state) => {
          const existingIndex = state.items.findIndex(
            (i) =>
              i.menu_item_id === incoming.menu_item_id &&
              i.note === normalizedNote
          );

          if (existingIndex > -1) {
            const updated = [...state.items];
            const current = updated[existingIndex];
            if (current) {
              updated[existingIndex] = {
                ...current,
                quantity: current.quantity + addQty,
              };
            }
            return { items: updated };
          }

          return {
            items: [
              ...state.items,
              {
                menu_item_id: incoming.menu_item_id,
                name: incoming.name,
                category: incoming.category,
                station: incoming.station,
                unit_price: incoming.unit_price,
                unit_cost_price: incoming.unit_cost_price,
                image_url: incoming.image_url,
                quantity: addQty,
                note: normalizedNote,
              },
            ],
          };
        });
      },

      updateQuantity: (menuItemId: string, quantity: number, note?: string) => {
        set((state) => {
          const targetNote = note !== undefined ? note.trim() : undefined;
          if (quantity <= 0) {
            return {
              items: state.items.filter(
                (i) =>
                  !(
                    i.menu_item_id === menuItemId &&
                    (targetNote === undefined || i.note === targetNote)
                  )
              ),
            };
          }

          return {
            items: state.items.map((i) =>
              i.menu_item_id === menuItemId &&
              (targetNote === undefined || i.note === targetNote)
                ? { ...i, quantity }
                : i
            ),
          };
        });
      },

      updateNote: (menuItemId: string, note: string) => {
        set((state) => ({
          items: state.items.map((i) =>
            i.menu_item_id === menuItemId ? { ...i, note } : i
          ),
        }));
      },

      removeItem: (menuItemId: string, note?: string) => {
        set((state) => {
          const targetNote = note !== undefined ? note.trim() : undefined;
          return {
            items: state.items.filter(
              (i) =>
                !(
                  i.menu_item_id === menuItemId &&
                  (targetNote === undefined || i.note === targetNote)
                )
            ),
          };
        });
      },

      clearCart: () => set({ items: [] }),

      getTotalQuantity: () =>
        get().items.reduce((sum, item) => sum + item.quantity, 0),

      getTotalAmount: () =>
        get().items.reduce(
          (sum, item) => sum + item.unit_price * item.quantity,
          0
        ),

      canSubmitOrder: () => {
        const now = Date.now();
        const recent = get().submissionTimestamps.filter(
          (ts) => now - ts < RATE_LIMIT_WINDOW_MS
        );
        return recent.length < MAX_SUBMISSIONS_PER_WINDOW;
      },

      recordOrderSubmission: () => {
        const now = Date.now();
        set((state) => ({
          submissionTimestamps: [
            ...state.submissionTimestamps.filter(
              (ts) => now - ts < RATE_LIMIT_WINDOW_MS
            ),
            now,
          ],
        }));
      },
    }),
    {
      name: '123dzo-customer-cart-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
