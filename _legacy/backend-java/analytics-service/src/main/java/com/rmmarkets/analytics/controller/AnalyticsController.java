package main.java.com.rmmarkets.analytics.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/analytics")
public class AnalyticsController {

    @GetMapping("/indicator")
    public ResponseEntity<?> indicator(@RequestParam String symbol,
                                       @RequestParam(defaultValue = "RSI") String type,
                                       @RequestParam(defaultValue = "100,101,102,103,104,103,102,101,100") String prices) {
        String[] parts = prices.split(",");
        double[] priceArr = new double[parts.length];

        for (int i = 0; i < parts.length; i++) {
            priceArr[i] = Double.parseDouble(parts[i]);
        }

        Map<String, Object> data = new HashMap<>();
        data.put("symbol", symbol.toUpperCase());
        data.put("type", type.toUpperCase());

        switch (type.toUpperCase()) {
            case "RSI":
                data.put("value", calculateRsi(priceArr));
                break;
            case "MACD":
                data.putAll(calculateMacd(priceArr));
                break;
            case "BOLLINGER":
                data.putAll(calculateBollinger(priceArr));
                break;
            case "SMA":
            case "EMA":
                data.put("value", calculateMa(priceArr, type.toUpperCase()));
                break;
            default:
                data.put("value", null);
        }

        return ResponseEntity.ok(data);
    }

    private Double calculateRsi(double[] prices) {
        if (prices.length < 2) {
            return null;
        }
        double gain = 0;
        double loss = 0;
        for (int i = 1; i < prices.length; i++) {
            double diff = prices[i] - prices[i - 1];
            if (diff > 0) {
                gain += diff;
            } else {
                loss -= diff;
            }
        }
        if (loss == 0) {
            return 100.0;
        }
        double rs = gain / loss;
        return Math.round((100 - (100 / (1 + rs))) * 100.0) / 100.0;
    }

    private Map<String, Object> calculateMacd(double[] prices) {
        double ema12 = calculateMa(prices, "EMA", 12);
        double ema26 = calculateMa(prices, "EMA", 26);
        double macd = ema12 - ema26;

        Map<String, Object> output = new HashMap<>();
        output.put("macd", Math.round(macd * 100.0) / 100.0);
        output.put("signal", Math.round((macd * 0.9) * 100.0) / 100.0);
        return output;
    }

    private Map<String, Object> calculateBollinger(double[] prices) {
        double sma = calculateMa(prices, "SMA", prices.length);
        double variance = 0;
        for (double price : prices) {
            variance += Math.pow(price - sma, 2);
        }
        variance /= prices.length;
        double stdDev = Math.sqrt(variance);

        Map<String, Object> output = new HashMap<>();
        output.put("upper", Math.round((sma + 2 * stdDev) * 100.0) / 100.0);
        output.put("lower", Math.round((sma - 2 * stdDev) * 100.0) / 100.0);
        output.put("middle", Math.round(sma * 100.0) / 100.0);
        return output;
    }

    private Double calculateMa(double[] prices, String method) {
        return calculateMa(prices, method, Math.min(14, prices.length));
    }

    private Double calculateMa(double[] prices, String method, int period) {
        if (prices.length < period || period <= 0) {
            return null;
        }
        double sum = 0;
        for (int i = prices.length - period; i < prices.length; i++) {
            sum += prices[i];
        }
        return Math.round((sum / period) * 100.0) / 100.0;
    }

    @GetMapping("/performance")
    public ResponseEntity<?> performance(@RequestParam String portfolioId) {
        Map<String, Object> performance = new HashMap<>();
        performance.put("portfolioId", portfolioId);
        performance.put("totalReturn", 0.125);
        performance.put("sharpeRatio", 1.42);
        performance.put("winLossRatio", 1.7);
        performance.put("drawdown", 0.08);
        return ResponseEntity.ok(performance);
    }
}
