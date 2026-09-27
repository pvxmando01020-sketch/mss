import 'package:flutter/material.dart';

/// شريحة صغيرة أسفل كل رد: "تم اختيار Claude — سؤال كتابة إبداعية" + زر تبديل يدوي
class RoutingBadge extends StatelessWidget {
  final String category;
  final String model;
  final double confidence;
  final String? method;
  final VoidCallback? onSwitch;
  final bool pinned;

  const RoutingBadge({super.key, required this.category, required this.model, required this.confidence, this.method, this.onSwitch, this.pinned = false});

  String get _catLabel {
    switch (category) {
      case 'code': return 'سؤال برمجة';
      case 'creative': return 'سؤال كتابة إبداعية';
      case 'analysis': return 'سؤال تحليل بيانات';
      case 'retrieval': return 'استخراج معلومات';
      default: return 'سؤال عام';
    }
  }

  String get _modelLabel {
    switch (model) {
      case 'strong-code': return 'Strong-Code';
      case 'claude': return 'Claude';
      case 'accurate-math': return 'Accurate-Math';
      case 'fast-cheap': return 'Fast-Cheap';
      default: return model;
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(color: cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(20)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(pinned ? Icons.push_pin : Icons.auto_awesome, size: 14, color: cs.primary),
        const SizedBox(width: 6),
        Flexible(child: Text('تم اختيار $_modelLabel — $_catLabel', style: Theme.of(context).textTheme.labelSmall, overflow: TextOverflow.ellipsis)),
        const SizedBox(width: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          decoration: BoxDecoration(color: cs.primaryContainer, borderRadius: BorderRadius.circular(10)),
          child: Text('${(confidence*100).toStringAsFixed(0)}%', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: cs.onPrimaryContainer)),
        ),
        if (onSwitch != null) ...[
          const SizedBox(width: 4),
          InkWell(
            onTap: onSwitch,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(border: Border.all(color: cs.outline), borderRadius: BorderRadius.circular(12)),
              child: const Text('تبديل', style: TextStyle(fontSize: 11)),
            ),
          ),
        ],
      ]),
    );
  }
}
