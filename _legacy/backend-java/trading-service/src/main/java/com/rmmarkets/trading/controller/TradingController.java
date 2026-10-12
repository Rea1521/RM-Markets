package com.rmmarkets.trading.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/trading")
public class TradingController {

    private final Map<UUID, Map<String, Object>> orderStore = new LinkedHashMap<>();
    private final Map<String, Map<String, Object>> positions = new HashMap<>();
    private double balance = 100000.0;

    @PostMapping("/order")
    public ResponseEntity<?> placeOrder(@RequestBody Map<String, Object> request) {
        String side = String.valueOf(request.getOrDefault("side", "BUY")).toUpperCase();
        double qty = Double.parseDouble(String.valueOf(request.getOrDefault("qty", "0")));
        double price = Double.parseDouble(String.valueOf(request.getOrDefault("price", "0")));
        String symbol = String.valueOf(request.getOrDefault("symbol", "UNKNOWN")).toUpperCase();

        if (qty <= 0 || price <= 0) {
            return ResponseEntity.badRequest().body(Map.of("error", "Quantity and price must be > 0"));
        }

        double cost = qty * price;
        if (side.equals("BUY") && cost > balance) {
            return ResponseEntity.badRequest().body(Map.of("error", "Insufficient funds"));
        }

        balance += side.equals("BUY") ? -cost : cost;

        UUID orderId = UUID.randomUUID();
        Map<String, Object> order = new LinkedHashMap<>();
        order.put("id", orderId);
        order.put("symbol", symbol);
        order.put("side", side);
        order.put("qty", qty);
        order.put("price", price);
        order.put("timestamp", Instant.now().toString());
        order.put("status", "EXECUTED");

        orderStore.put(orderId, order);

        positions.compute(symbol, (k, old) -> {
            if (old == null) {
                return new HashMap<>(Map.of(
                        "symbol", symbol,
                        "quantity", side.equals("BUY") ? qty : -qty,
                        "avgPrice", price,
                        "unrealizedPnL", 0.0));
            }
            double prevQty = Double.parseDouble(old.get("quantity").toString());
            double nextQty = prevQty + (side.equals("BUY") ? qty : -qty);
            old.put("quantity", nextQty);
            old.put("avgPrice", price);
            return old;
        });

        return ResponseEntity.ok(order);
    }

    @GetMapping("/orders")
    public ResponseEntity<?> listOrders() {
        return ResponseEntity.ok(orderStore.values());
    }

    @GetMapping("/positions")
    public ResponseEntity<?> positions() {
        return ResponseEntity.ok(positions.values());
    }

    @GetMapping("/portfolio")
    public ResponseEntity<?> portfolio() {
        Map<String, Object> portfolio = new HashMap<>();
        portfolio.put("cashBalance", Math.round(balance * 100.0) / 100.0);
        portfolio.put("positions", positions.values());
        portfolio.put("equity", Math.round((balance + positions.size() * 1000) * 100.0) / 100.0);
        return ResponseEntity.ok(portfolio);
    }
}
