
import { useCallback } from 'react';

// FIX 6 — Expanded keyword knowledge base covering the four problem types the
// paper describes: algebra, calculus, geometry, statistics.
// Each entry has keywords for substring-matching and a concise answer with formula.
const knowledgeBase = [
  // ── ALGEBRA ──────────────────────────────────────────────────────────────
  {
    keywords: ['pythagorean', 'theorem', 'right triangle', 'hypotenuse'],
    answer:
      'The Pythagorean theorem states that in a right-angled triangle the square of the hypotenuse equals the sum of the squares of the other two sides: a² + b² = c², where c is the hypotenuse.',
  },
  {
    keywords: ['quadratic', 'formula', 'ax^2', 'ax²', 'roots', 'discriminant'],
    answer:
      'The quadratic formula solves ax² + bx + c = 0: x = (−b ± √(b² − 4ac)) / (2a). The discriminant b² − 4ac determines whether roots are real (> 0), repeated (= 0), or complex (< 0).',
  },
  {
    keywords: ['linear equation', 'solve for x', 'first degree', 'one variable', 'slope intercept'],
    answer:
      'A linear equation in one variable has the form ax + b = 0, giving x = −b/a. The slope-intercept form of a line is y = mx + b where m is slope and b is the y-intercept.',
  },
  {
    keywords: ['system of equations', 'simultaneous', 'elimination', 'substitution method'],
    answer:
      'A system of two linear equations can be solved by substitution (express one variable in terms of the other) or elimination (add/subtract equations to cancel a variable). For 2×2 systems, Cramer\'s rule gives x = Dₓ/D and y = Dᵧ/D where D is the determinant of the coefficient matrix.',
  },
  {
    keywords: ['polynomial', 'factor', 'factoring', 'factorisation', 'roots of polynomial'],
    answer:
      'Factoring a polynomial means expressing it as a product of lower-degree polynomials. Common techniques: greatest common factor (GCF), difference of squares a² − b² = (a − b)(a + b), sum/difference of cubes, and grouping.',
  },
  {
    keywords: ['inequality', 'inequalities', 'solve inequality', 'number line'],
    answer:
      'When solving inequalities, apply the same operations as equations but flip the inequality sign when multiplying or dividing both sides by a negative number. The solution is an interval on the number line.',
  },
  {
    keywords: ['function', 'domain', 'range', 'f(x)', 'mapping'],
    answer:
      'A function f maps each input x in its domain to exactly one output f(x) in its range. The vertical line test checks if a graph represents a function. Common representations: equation, table, graph, or arrow diagram.',
  },
  {
    keywords: ['exponent', 'power', 'base', 'exponent rules', 'laws of exponents'],
    answer:
      'Laws of exponents: aᵐ · aⁿ = aᵐ⁺ⁿ, aᵐ / aⁿ = aᵐ⁻ⁿ, (aᵐ)ⁿ = aᵐⁿ, a⁰ = 1 (a ≠ 0), a⁻ⁿ = 1/aⁿ. For fractional exponents: a^(m/n) = ⁿ√(aᵐ).',
  },
  {
    keywords: ['logarithm', 'log', 'ln', 'natural log', 'change of base'],
    answer:
      'log_b(x) = y means bʸ = x. Properties: log(ab) = log a + log b, log(a/b) = log a − log b, log(aⁿ) = n·log a. Change of base: log_b(x) = ln(x) / ln(b). ln is the natural logarithm (base e ≈ 2.718).',
  },

  // ── CALCULUS ──────────────────────────────────────────────────────────────
  {
    keywords: ['derivative', 'differentiate', 'differentiation', 'd/dx', "f'(x)"],
    answer:
      "The derivative f'(x) measures the instantaneous rate of change of f at x. Power rule: d/dx(xⁿ) = nxⁿ⁻¹. The derivative of a constant is 0. Sum/difference rule: (f ± g)' = f' ± g'.",
  },
  {
    keywords: ['chain rule', 'composite function', 'outer function', 'inner function'],
    answer:
      'The chain rule differentiates composite functions: if h(x) = f(g(x)) then h\'(x) = f\'(g(x)) · g\'(x). In Leibniz notation: dy/dx = (dy/du) · (du/dx). Always differentiate the outer function first, keep the inner unchanged, then multiply by the derivative of the inner.',
  },
  {
    keywords: ['product rule', 'derivative of product', 'uv rule'],
    answer:
      "Product rule: d/dx[f(x)·g(x)] = f'(x)·g(x) + f(x)·g'(x). Mnemonic: 'first times derivative of second plus second times derivative of first'.",
  },
  {
    keywords: ['quotient rule', 'derivative of quotient', 'derivative of fraction'],
    answer:
      "Quotient rule: d/dx[f(x)/g(x)] = [f'(x)·g(x) − f(x)·g'(x)] / [g(x)]². Mnemonic: 'low d-high minus high d-low over low squared'.",
  },
  {
    keywords: ['integral', 'integration', 'antiderivative', '∫', 'indefinite integral'],
    answer:
      'An integral reverses differentiation. Power rule for integration: ∫xⁿ dx = xⁿ⁺¹/(n+1) + C (n ≠ −1). ∫eˣ dx = eˣ + C. ∫(1/x) dx = ln|x| + C. Always add the constant of integration C for indefinite integrals.',
  },
  {
    keywords: ['definite integral', 'area under curve', 'fundamental theorem', 'limits of integration'],
    answer:
      'The Fundamental Theorem of Calculus: ∫ₐᵇ f(x) dx = F(b) − F(a) where F is any antiderivative of f. The definite integral gives the net signed area between the curve and the x-axis from x = a to x = b.',
  },
  {
    keywords: ['limit', 'lim', 'approaches', 'infinity', 'continuity'],
    answer:
      'A limit lim_{x→c} f(x) = L means f(x) gets arbitrarily close to L as x approaches c. Key rules: sum, product, quotient of limits. L\'Hôpital\'s rule: if 0/0 or ∞/∞ form, differentiate numerator and denominator separately.',
  },

  // ── GEOMETRY ─────────────────────────────────────────────────────────────
  {
    keywords: ['area', 'circle', 'pi', 'radius', 'πr²'],
    answer:
      'The area of a circle is A = πr², where r is the radius and π ≈ 3.14159. The circumference is C = 2πr. For a sector with central angle θ (radians): sector area = ½r²θ.',
  },
  {
    keywords: ['arc length', 'arc', 'sector', 'central angle', 'radian'],
    answer:
      'Arc length of a sector = rθ where r is the radius and θ is the central angle in radians. To convert degrees to radians: multiply by π/180. Example: 60° = π/3 radians.',
  },
  {
    keywords: ['perimeter', 'rectangle', 'triangle', 'polygon'],
    answer:
      'Perimeter of a rectangle = 2(l + w). Perimeter of a triangle = a + b + c. Area of a triangle = ½ × base × height, or using Heron\'s formula: A = √(s(s−a)(s−b)(s−c)) where s = (a+b+c)/2.',
  },
  {
    keywords: ['volume', 'sphere', 'cylinder', 'cone', 'cube'],
    answer:
      'Key volume formulas — Sphere: V = (4/3)πr³. Cylinder: V = πr²h. Cone: V = (1/3)πr²h. Cube: V = a³. Rectangular prism: V = lwh. Surface area of a sphere: S = 4πr².',
  },
  {
    keywords: ['trigonometry', 'sin', 'cos', 'tan', 'soh cah toa'],
    answer:
      'In a right triangle: sin θ = opposite/hypotenuse, cos θ = adjacent/hypotenuse, tan θ = opposite/adjacent (SOH-CAH-TOA). Pythagorean identity: sin²θ + cos²θ = 1. Values at 30°, 45°, 60° are frequently tested.',
  },
  {
    keywords: ['similar triangles', 'similarity', 'congruent', 'proportional sides'],
    answer:
      'Two triangles are similar if their angles are equal (AA, SAS, or SSS similarity). Corresponding sides of similar triangles are in the same ratio (scale factor). Perimeters scale by the scale factor; areas scale by the square of the scale factor.',
  },
  {
    keywords: ['coordinate geometry', 'distance formula', 'midpoint', 'slope'],
    answer:
      'Distance between (x₁,y₁) and (x₂,y₂): d = √((x₂−x₁)² + (y₂−y₁)²). Midpoint: M = ((x₁+x₂)/2, (y₁+y₂)/2). Slope: m = (y₂−y₁)/(x₂−x₁). Parallel lines have equal slopes; perpendicular lines have slopes whose product is −1.',
  },
  {
    keywords: ['circle theorems', 'chord', 'tangent', 'inscribed angle'],
    answer:
      'Key circle theorems: The angle at the centre is twice the angle at the circumference subtended by the same arc. Angles in the same segment are equal. A radius to a tangent point is perpendicular to the tangent. Opposite angles of a cyclic quadrilateral sum to 180°.',
  },

  // ── STATISTICS ───────────────────────────────────────────────────────────
  {
    keywords: ['mean', 'average', 'arithmetic mean', 'sum divided'],
    answer:
      'The arithmetic mean (average) = Σx / n, the sum of all values divided by the count. It is sensitive to outliers. For grouped data: mean = Σ(f·x) / Σf where f is frequency and x is the class midpoint.',
  },
  {
    keywords: ['median', 'middle value', 'ordered data'],
    answer:
      'The median is the middle value when data is sorted in order. For n values: if n is odd, median = value at position (n+1)/2; if n is even, median = average of values at positions n/2 and n/2 + 1. The median is resistant to outliers.',
  },
  {
    keywords: ['mode', 'most frequent', 'bimodal'],
    answer:
      'The mode is the value(s) that appear most frequently in a data set. A data set can be unimodal (one mode), bimodal (two modes), or multimodal. If all values appear equally often there is no mode.',
  },
  {
    keywords: ['standard deviation', 'variance', 'spread', 'σ'],
    answer:
      'Variance σ² = Σ(xᵢ − μ)² / N (population) or Σ(xᵢ − x̄)² / (n−1) (sample). Standard deviation σ = √variance. It measures how spread out data is around the mean. Roughly 68% of normally distributed data lies within ±1σ of the mean.',
  },
  {
    keywords: ['probability', 'event', 'sample space', 'p(a)', 'likelihood'],
    answer:
      'Probability P(A) = (favourable outcomes) / (total outcomes) for equally likely events, 0 ≤ P(A) ≤ 1. Addition rule: P(A ∪ B) = P(A) + P(B) − P(A ∩ B). Multiplication rule for independent events: P(A ∩ B) = P(A) · P(B).',
  },
  {
    keywords: ['normal distribution', 'bell curve', 'z-score', 'standard normal'],
    answer:
      'The normal distribution N(μ, σ²) is symmetric and bell-shaped. Z-score: z = (x − μ) / σ converts any normal value to the standard normal (mean 0, sd 1). The 68-95-99.7 rule: 68% within ±1σ, 95% within ±2σ, 99.7% within ±3σ.',
  },
  {
    keywords: ['hypothesis test', 'p-value', 'null hypothesis', 'significance level', 'alpha'],
    answer:
      'Hypothesis testing: set H₀ (null) and H₁ (alternative), choose significance level α (usually 0.05). Compute the test statistic and corresponding p-value. If p-value < α, reject H₀. The p-value is the probability of observing results at least as extreme as the data under H₀.',
  },
  {
    keywords: ['permutation', 'combination', 'nCr', 'nPr', 'factorial', 'choose'],
    answer:
      'Permutations (order matters): P(n,r) = n! / (n−r)!. Combinations (order does not matter): C(n,r) = n! / (r!(n−r)!). n! = n × (n−1) × … × 1. Example: C(5,2) = 10 ways to choose 2 items from 5.',
  },
];

export const useKnowledgeBase = () => {
  const searchKB = useCallback((query: string): string | null => {
    const lower = query.toLowerCase();
    for (const entry of knowledgeBase) {
      if (entry.keywords.some(kw => lower.includes(kw))) {
        return entry.answer;
      }
    }
    return null;
  }, []);

  return { searchKB };
};
