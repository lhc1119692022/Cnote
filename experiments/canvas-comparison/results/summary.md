# Automated comparison — numerical summary

Source: accepted.json
Rows: 670; case failures: 0
Renderer: normal window (showInactive); requested 1440x900; backgroundThrottling=false; production React
GPU compositing: disabled_software

Numbers are medians across repetitions. They are not pooled-frame percentiles. Full ranges and raw frames are in the JSON files.
Production-current is a separate product reference, not feature-equivalent to the small engine prototypes.
Software compositing results do not establish hardware-GPU performance. Native input checks are reported separately.

## engine

| Variant and conditions | n | frameP95Ms | writeP95Ms | layoutMs | styleMs | taskMs | mounts | mounted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| current-model; count=100, action=drag | 5 | 4.300 | 0.700 | 3.893 | 5.883 | 98.662 | 0.000 | 100.000 |
| production-current; count=100, action=drag | 5 | 16.800 | 8.000 | 15.810 | 60.782 | 593.822 | 2.000 | 36.000 |
| reactflow-11; count=100, action=drag | 5 | 29.100 | 2.600 | 6.001 | 358.423 | 1065.102 | 0.000 | 100.000 |
| reactflow-lifted; count=100, action=drag | 5 | 12.600 | 2.700 | 6.157 | 92.870 | 491.643 | 0.000 | 100.000 |
| shared-transform; count=100, action=drag | 5 | 8.400 | 0.500 | 5.204 | 6.497 | 337.790 | 0.000 | 100.000 |
| current-model; count=100, action=pan | 5 | 8.200 | 0.700 | 4.428 | 20.708 | 201.126 | 0.000 | 100.000 |
| production-current; count=100, action=pan | 5 | 21.200 | 8.200 | 44.098 | 91.089 | 850.396 | 41.000 | 36.000 |
| reactflow-11; count=100, action=pan | 5 | 4.300 | 0.100 | 0.000 | 0.912 | 134.562 | 0.000 | 100.000 |
| reactflow-lifted; count=100, action=pan | 5 | 4.300 | 0.300 | 0.000 | 6.761 | 132.405 | 0.000 | 100.000 |
| shared-transform; count=100, action=pan | 5 | 8.400 | 0.100 | 0.000 | 0.934 | 225.158 | 0.000 | 100.000 |
| current-model; count=100, action=zoom | 5 | 25.000 | 1.100 | 326.241 | 189.831 | 862.162 | 0.000 | 100.000 |
| production-current; count=100, action=zoom | 5 | 37.400 | 21.800 | 200.916 | 178.024 | 1164.787 | 87.000 | 36.000 |
| reactflow-11; count=100, action=zoom | 5 | 12.500 | 0.100 | 0.000 | 1.258 | 209.840 | 0.000 | 100.000 |
| reactflow-lifted; count=100, action=zoom | 5 | 24.900 | 0.400 | 293.883 | 163.209 | 782.849 | 0.000 | 100.000 |
| shared-transform; count=100, action=zoom | 5 | 8.400 | 0.100 | 0.000 | 1.160 | 259.816 | 0.000 | 100.000 |
| current-model; count=300, action=drag | 5 | 4.300 | 1.300 | 8.748 | 6.475 | 128.523 | 0.000 | 300.000 |
| production-current; count=300, action=drag | 5 | 37.500 | 23.000 | 29.427 | 129.511 | 1523.685 | 2.000 | 36.000 |
| reactflow-11; count=300, action=drag | 5 | 79.200 | 8.000 | 15.323 | 1059.128 | 3354.300 | 0.000 | 300.000 |
| reactflow-lifted; count=300, action=drag | 5 | 33.400 | 8.100 | 16.147 | 263.837 | 1269.312 | 0.000 | 300.000 |
| shared-transform; count=300, action=drag | 5 | 50.000 | 1.000 | 11.998 | 7.526 | 1948.169 | 0.000 | 300.000 |
| current-model; count=300, action=pan | 5 | 12.500 | 1.700 | 12.203 | 63.707 | 417.593 | 0.000 | 300.000 |
| production-current; count=300, action=pan | 5 | 58.400 | 23.300 | 120.099 | 218.487 | 2312.537 | 41.000 | 36.000 |
| reactflow-11; count=300, action=pan | 5 | 20.800 | 0.100 | 0.000 | 1.245 | 682.131 | 0.000 | 300.000 |
| reactflow-lifted; count=300, action=pan | 5 | 8.300 | 0.600 | 0.000 | 18.260 | 208.596 | 0.000 | 300.000 |
| shared-transform; count=300, action=pan | 5 | 45.800 | 0.100 | 0.000 | 2.279 | 1787.634 | 0.000 | 300.000 |
| current-model; count=300, action=zoom | 5 | 50.100 | 2.900 | 860.020 | 504.255 | 2022.279 | 0.000 | 300.000 |
| production-current; count=300, action=zoom | 5 | 70.800 | 45.000 | 282.525 | 310.776 | 2548.715 | 87.000 | 36.000 |
| reactflow-11; count=300, action=zoom | 5 | 33.300 | 0.100 | 0.000 | 1.412 | 852.699 | 0.000 | 300.000 |
| reactflow-lifted; count=300, action=zoom | 5 | 54.200 | 0.800 | 911.480 | 487.052 | 2160.625 | 0.000 | 300.000 |
| shared-transform; count=300, action=zoom | 5 | 54.200 | 0.100 | 0.000 | 2.112 | 2125.088 | 0.000 | 300.000 |

## scale

| Variant and conditions | n | frameP95Ms | writeP95Ms | layoutMs | styleMs | taskMs | mounts | mounted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| transform; count=100, action=pan | 5 | 4.300 | 0.300 | 0.248 | 8.870 | 89.748 | 0.000 | 100.000 |
| zoom; count=100, action=pan | 5 | 4.300 | 0.400 | 0.183 | 11.048 | 110.905 | 0.000 | 100.000 |
| transform; count=100, action=zoom | 5 | 8.400 | 0.600 | 11.029 | 16.900 | 141.826 | 0.000 | 100.000 |
| zoom; count=100, action=zoom | 5 | 25.000 | 0.400 | 304.901 | 170.018 | 857.710 | 0.000 | 100.000 |
| transform; count=300, action=pan | 5 | 8.200 | 1.200 | 1.004 | 26.375 | 171.558 | 0.000 | 300.000 |
| zoom; count=300, action=pan | 5 | 4.300 | 0.500 | 0.467 | 18.590 | 138.543 | 0.000 | 300.000 |
| transform; count=300, action=zoom | 5 | 14.000 | 1.300 | 43.224 | 66.557 | 354.691 | 0.000 | 300.000 |
| zoom; count=300, action=zoom | 5 | 58.300 | 0.900 | 1002.355 | 539.453 | 2209.197 | 0.000 | 300.000 |

## virtual

| Variant and conditions | n | frameP95Ms | writeP95Ms | layoutMs | styleMs | taskMs | mounts | mounted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adaptive-pin; count=100, heavy=false | 5 | 4.300 | 0.400 | 4.549 | 5.888 | 63.264 | 45.000 | 43.000 |
| all; count=100, heavy=false | 5 | 4.300 | 0.300 | 3.624 | 5.075 | 60.927 | 0.000 | 100.000 |
| current-pin; count=100, heavy=false | 5 | 4.300 | 0.400 | 4.263 | 5.486 | 55.240 | 45.000 | 43.000 |
| threshold24-global; count=100, heavy=false | 5 | 4.300 | 0.500 | 4.442 | 5.618 | 57.851 | 107.000 | 100.000 |
| adaptive-pin; count=100, heavy=true | 5 | 4.300 | 0.600 | 8.544 | 6.813 | 144.737 | 45.000 | 43.000 |
| all; count=100, heavy=true | 5 | 4.300 | 0.400 | 4.436 | 5.382 | 161.095 | 0.000 | 100.000 |
| current-pin; count=100, heavy=true | 5 | 4.300 | 0.500 | 9.923 | 7.221 | 173.307 | 45.000 | 43.000 |
| threshold24-global; count=100, heavy=true | 5 | 8.400 | 0.900 | 14.684 | 8.794 | 211.958 | 107.000 | 100.000 |
| adaptive-pin; count=12, heavy=false | 5 | 4.300 | 0.200 | 2.746 | 1.590 | 25.130 | 0.000 | 12.000 |
| all; count=12, heavy=false | 5 | 4.300 | 0.200 | 2.223 | 1.510 | 21.058 | 0.000 | 12.000 |
| current-pin; count=12, heavy=false | 5 | 4.300 | 0.300 | 2.729 | 1.829 | 23.962 | 5.000 | 8.000 |
| threshold24-global; count=12, heavy=false | 5 | 4.300 | 0.200 | 2.109 | 1.372 | 19.682 | 0.000 | 12.000 |
| adaptive-pin; count=12, heavy=true | 5 | 4.300 | 0.300 | 3.347 | 1.753 | 38.997 | 5.000 | 8.000 |
| all; count=12, heavy=true | 5 | 4.300 | 0.200 | 2.206 | 1.131 | 37.314 | 0.000 | 12.000 |
| current-pin; count=12, heavy=true | 5 | 4.300 | 0.400 | 3.454 | 2.148 | 54.900 | 5.000 | 8.000 |
| threshold24-global; count=12, heavy=true | 5 | 4.300 | 0.200 | 2.281 | 1.521 | 40.440 | 0.000 | 12.000 |
| adaptive-pin; count=24, heavy=false | 5 | 4.300 | 0.200 | 2.983 | 2.339 | 41.619 | 0.000 | 24.000 |
| all; count=24, heavy=false | 5 | 4.300 | 0.200 | 3.028 | 2.221 | 35.425 | 0.000 | 24.000 |
| current-pin; count=24, heavy=false | 5 | 4.300 | 0.300 | 2.963 | 2.360 | 34.295 | 11.000 | 16.000 |
| threshold24-global; count=24, heavy=false | 5 | 4.300 | 0.300 | 2.730 | 2.127 | 30.264 | 14.000 | 24.000 |
| adaptive-pin; count=24, heavy=true | 5 | 4.300 | 0.300 | 3.952 | 2.282 | 62.264 | 11.000 | 16.000 |
| all; count=24, heavy=true | 5 | 4.300 | 0.200 | 2.899 | 2.278 | 65.704 | 0.000 | 24.000 |
| current-pin; count=24, heavy=true | 5 | 4.300 | 0.300 | 4.957 | 3.039 | 69.180 | 11.000 | 16.000 |
| threshold24-global; count=24, heavy=true | 5 | 4.300 | 0.400 | 4.480 | 2.983 | 71.648 | 14.000 | 24.000 |
| adaptive-pin; count=300, heavy=false | 5 | 4.300 | 0.700 | 8.729 | 15.248 | 99.671 | 45.000 | 43.000 |
| all; count=300, heavy=false | 5 | 8.300 | 0.800 | 10.220 | 18.194 | 196.019 | 0.000 | 300.000 |
| current-pin; count=300, heavy=false | 5 | 4.300 | 0.600 | 7.978 | 14.118 | 92.351 | 45.000 | 43.000 |
| threshold24-global; count=300, heavy=false | 5 | 4.400 | 1.500 | 13.280 | 16.755 | 124.793 | 507.000 | 300.000 |
| adaptive-pin; count=300, heavy=true | 5 | 8.400 | 0.700 | 11.179 | 13.339 | 175.136 | 45.000 | 43.000 |
| all; count=300, heavy=true | 5 | 8.400 | 0.700 | 8.640 | 14.829 | 322.092 | 0.000 | 300.000 |
| current-pin; count=300, heavy=true | 5 | 4.300 | 0.700 | 11.893 | 14.374 | 180.995 | 45.000 | 43.000 |
| threshold24-global; count=300, heavy=true | 5 | 12.500 | 3.900 | 50.377 | 23.867 | 364.097 | 507.000 | 300.000 |

## virtual-steady

| Variant and conditions | n | frameP95Ms | writeP95Ms | layoutMs | styleMs | taskMs | mounts | mounted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| adaptive-pin; count=100, heavy=false | 5 | 4.300 | 0.400 | 5.123 | 6.028 | 61.747 | 43.000 | 43.000 |
| all; count=100, heavy=false | 5 | 4.300 | 0.300 | 4.327 | 5.173 | 66.876 | 0.000 | 100.000 |
| current-pin; count=100, heavy=false | 5 | 4.300 | 0.400 | 5.099 | 5.896 | 67.164 | 43.000 | 43.000 |
| threshold24-global; count=100, heavy=false | 5 | 4.300 | 0.300 | 4.174 | 5.189 | 64.240 | 0.000 | 100.000 |
| adaptive-pin; count=100, heavy=true | 5 | 4.300 | 0.600 | 10.286 | 7.400 | 162.931 | 43.000 | 43.000 |
| all; count=100, heavy=true | 5 | 8.400 | 0.500 | 5.781 | 5.881 | 197.795 | 0.000 | 100.000 |
| current-pin; count=100, heavy=true | 5 | 4.300 | 0.500 | 8.520 | 6.238 | 142.357 | 43.000 | 43.000 |
| threshold24-global; count=100, heavy=true | 5 | 4.300 | 0.400 | 4.522 | 5.009 | 149.609 | 0.000 | 100.000 |
| adaptive-pin; count=300, heavy=false | 5 | 4.300 | 0.700 | 8.688 | 14.319 | 99.703 | 43.000 | 43.000 |
| all; count=300, heavy=false | 5 | 8.400 | 1.000 | 13.837 | 23.636 | 233.046 | 0.000 | 300.000 |
| current-pin; count=300, heavy=false | 5 | 4.200 | 0.600 | 8.330 | 13.545 | 96.398 | 43.000 | 43.000 |
| threshold24-global; count=300, heavy=false | 5 | 4.300 | 0.800 | 8.576 | 14.208 | 145.273 | 0.000 | 300.000 |
| adaptive-pin; count=300, heavy=true | 5 | 8.300 | 0.700 | 12.640 | 14.539 | 196.721 | 43.000 | 43.000 |
| all; count=300, heavy=true | 5 | 8.500 | 0.900 | 9.772 | 14.838 | 329.294 | 0.000 | 300.000 |
| current-pin; count=300, heavy=true | 5 | 4.300 | 0.600 | 11.978 | 13.493 | 175.081 | 43.000 | 43.000 |
| threshold24-global; count=300, heavy=true | 5 | 8.400 | 0.700 | 8.658 | 13.870 | 301.760 | 0.000 | 300.000 |

## material

| Variant and conditions | n | frameP95Ms | writeP95Ms | layoutMs | styleMs | taskMs | mounts | mounted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| combined; count=100, action=pan | 5 | 4.300 | 0.100 | 0.000 | 1.996 | 71.823 | 0.000 | 100.000 |
| gradient; count=100, action=pan | 5 | 4.300 | 0.100 | 0.000 | 2.142 | 71.955 | 0.000 | 100.000 |
| noise; count=100, action=pan | 5 | 4.300 | 0.100 | 0.000 | 1.834 | 79.007 | 0.000 | 100.000 |
| plain; count=100, action=pan | 5 | 4.300 | 0.100 | 0.000 | 2.303 | 78.347 | 0.000 | 100.000 |
| combined; count=300, action=pan | 5 | 8.400 | 0.100 | 0.000 | 3.143 | 242.524 | 0.000 | 300.000 |
| gradient; count=300, action=pan | 5 | 10.500 | 0.100 | 0.000 | 3.018 | 310.090 | 0.000 | 300.000 |
| noise; count=300, action=pan | 5 | 8.400 | 0.100 | 0.000 | 2.551 | 244.499 | 0.000 | 300.000 |
| plain; count=300, action=pan | 5 | 8.300 | 0.100 | 0.000 | 2.817 | 212.744 | 0.000 | 300.000 |

## transport

| Variant and conditions | n | firstMs | elapsedMs | deliveryP95Ms |
| --- | --- | --- | --- | --- |
| http; count=12, rate=20, bytes=128 | 5 | 40.800 | 583.000 | 1.215 |
| ipc-pull; count=12, rate=20, bytes=128 | 5 | 40.500 | 586.800 | 0.578 |
| message-port; count=12, rate=20, bytes=128 | 5 | 38.000 | 583.200 | 0.989 |
| http; count=12, rate=20, bytes=4096 | 5 | 40.100 | 589.100 | 1.021 |
| ipc-pull; count=12, rate=20, bytes=4096 | 5 | 35.100 | 590.800 | 1.139 |
| message-port; count=12, rate=20, bytes=4096 | 5 | 39.000 | 584.800 | 0.998 |
| http; count=18, rate=60, bytes=128 | 5 | 36.700 | 323.400 | 1.065 |
| ipc-pull; count=18, rate=60, bytes=128 | 5 | 40.600 | 320.900 | 0.586 |
| message-port; count=18, rate=60, bytes=128 | 5 | 36.800 | 320.800 | 0.941 |
| http; count=18, rate=60, bytes=4096 | 5 | 34.700 | 323.900 | 1.111 |
| ipc-pull; count=18, rate=60, bytes=4096 | 5 | 34.600 | 322.200 | 1.015 |
| message-port; count=18, rate=60, bytes=4096 | 5 | 36.200 | 317.100 | 0.707 |
| http; count=256, rate=0, bytes=128 | 5 | 40.000 | 40.500 | 1.244 |
| ipc-pull; count=256, rate=0, bytes=128 | 5 | 37.600 | 69.800 | 0.371 |
| message-port; count=256, rate=0, bytes=128 | 5 | 43.200 | 66.500 | 0.761 |
| http; count=256, rate=0, bytes=4096 | 5 | 43.200 | 48.200 | 0.905 |
| ipc-pull; count=256, rate=0, bytes=4096 | 5 | 40.900 | 180.500 | 0.802 |
| message-port; count=256, rate=0, bytes=4096 | 5 | 37.500 | 64.700 | 0.749 |
| http; count=60, rate=200, bytes=128 | 5 | 39.900 | 332.200 | 0.840 |
| ipc-pull; count=60, rate=200, bytes=128 | 5 | 38.100 | 332.600 | 0.521 |
| message-port; count=60, rate=200, bytes=128 | 5 | 31.800 | 330.800 | 0.909 |
| http; count=60, rate=200, bytes=4096 | 5 | 41.800 | 334.400 | 0.992 |
| ipc-pull; count=60, rate=200, bytes=4096 | 5 | 40.000 | 334.200 | 0.962 |
| message-port; count=60, rate=200, bytes=4096 | 5 | 39.800 | 335.200 | 0.932 |

## isolation

| Variant and conditions | n | elapsedMs | computeMs | worstGapMs |
| --- | --- | --- | --- | --- |
| renderer; megabytes=0.1 | 5 | 0.100 | 0.100 | 3.400 |
| utility; megabytes=0.1 | 5 | 2.900 | 0.124 | 4.000 |
| worker; megabytes=0.1 | 5 | 0.900 | 0.200 | 10.900 |
| renderer; megabytes=1 | 5 | 0.900 | 0.900 | 3.400 |
| utility; megabytes=1 | 5 | 21.500 | 2.300 | 5.100 |
| worker; megabytes=1 | 5 | 6.000 | 2.400 | 5.000 |
| renderer; megabytes=32 | 5 | 62.100 | 62.100 | 62.400 |
| utility; megabytes=32 | 5 | 703.800 | 67.084 | 103.200 |
| worker; megabytes=32 | 5 | 180.200 | 51.900 | 40.300 |
| renderer; megabytes=8 | 5 | 10.600 | 10.600 | 11.100 |
| utility; megabytes=8 | 5 | 154.500 | 10.390 | 23.100 |
| worker; megabytes=8 | 5 | 49.300 | 11.500 | 12.400 |

## production-update

| Variant and conditions | n | frameP95Ms | writeP95Ms | layoutMs | styleMs | taskMs | mounts | mounted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| production-batched; count=100, action=drag | 5 | 20.800 | 9.900 | 17.658 | 72.080 | 666.146 | 2.000 | 36.000 |
| production-current; count=100, action=drag | 5 | 16.800 | 7.700 | 16.263 | 63.136 | 634.309 | 2.000 | 36.000 |
| production-batched; count=300, action=drag | 5 | 62.500 | 39.500 | 43.090 | 185.424 | 2237.896 | 2.000 | 36.000 |
| production-current; count=300, action=drag | 5 | 41.600 | 25.300 | 30.708 | 134.011 | 1589.749 | 2.000 | 36.000 |
