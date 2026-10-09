// src/data/found-proofs.js —— 由 tools/gen-proofs.mjs 自动生成：解算器搜到的证明
// 说明：这是搜索器的产物，与 levels.js 里手写的标准证明相互独立，用于交叉验证与提示。
// 重新生成：node tools/gen-proofs.mjs

export const FOUND_PROOFS = {
  "L0-01": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p1"
        ]
      }
    ],
    "derivations": [],
    "ms": 3,
    "nodes": 1
  },
  "L0-02": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "atom",
          "name": "A",
          "args": []
        },
        "scope": "H1"
      },
      {
        "rule": "hyp",
        "ids": [
          "H1"
        ]
      },
      {
        "rule": "impI",
        "ids": [
          "f1"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [],
    "ms": 1,
    "nodes": 2
  },
  "L0-03": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "atom",
            "name": "B",
            "args": []
          }
        },
        "scope": "H1"
      },
      {
        "rule": "negE",
        "ids": [
          "H1",
          "f1"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f2"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [
      {
        "rule": "impE",
        "ids": [
          "p1",
          "p2"
        ]
      }
    ],
    "ms": 1,
    "nodes": 4
  },
  "L0-04": {
    "steps": [
      {
        "rule": "andE",
        "ids": [
          "p1"
        ],
        "pick": "左"
      }
    ],
    "derivations": [],
    "ms": 1,
    "nodes": 3
  },
  "L0-05": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p1"
        ]
      },
      {
        "rule": "hyp",
        "ids": [
          "p2"
        ]
      },
      {
        "rule": "andI",
        "ids": [
          "f1",
          "f2"
        ]
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 3
  },
  "L0-06": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p1"
        ]
      },
      {
        "rule": "orI",
        "ids": [
          "f1"
        ],
        "formula": {
          "k": "or",
          "a": {
            "k": "atom",
            "name": "A",
            "args": []
          },
          "b": {
            "k": "atom",
            "name": "B",
            "args": []
          }
        }
      }
    ],
    "derivations": [],
    "ms": 1,
    "nodes": 2
  },
  "L0-07": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p2"
        ]
      },
      {
        "rule": "hyp",
        "ids": [
          "p3"
        ]
      },
      {
        "rule": "orE",
        "ids": [
          "p1",
          "f1",
          "f2"
        ]
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 25
  },
  "L0-08": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "atom",
          "name": "A",
          "args": []
        },
        "scope": "H1"
      },
      {
        "rule": "impE",
        "ids": [
          "p1",
          "H1"
        ]
      },
      {
        "rule": "negE",
        "ids": [
          "p2",
          "f1"
        ]
      },
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "bot"
          }
        },
        "scope": "H2"
      },
      {
        "rule": "hyp",
        "ids": [
          "f2"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f3"
        ],
        "scope": "H2"
      },
      {
        "rule": "negI",
        "ids": [
          "f4"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 13
  },
  "L0-09": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "atom",
            "name": "A",
            "args": []
          }
        },
        "scope": "H1"
      },
      {
        "rule": "impE",
        "ids": [
          "p1",
          "H1"
        ]
      },
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "bot"
          }
        },
        "scope": "H2"
      },
      {
        "rule": "hyp",
        "ids": [
          "f1"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f2"
        ],
        "scope": "H2"
      },
      {
        "rule": "raa",
        "ids": [
          "f3"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 11
  },
  "L0-10": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "atom",
            "name": "B",
            "args": []
          }
        },
        "scope": "H1"
      },
      {
        "rule": "assume",
        "assume": {
          "k": "atom",
          "name": "A",
          "args": []
        },
        "scope": "H2"
      },
      {
        "rule": "impE",
        "ids": [
          "p1",
          "H2"
        ]
      },
      {
        "rule": "negE",
        "ids": [
          "H1",
          "f1"
        ]
      },
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "bot"
          }
        },
        "scope": "H3"
      },
      {
        "rule": "hyp",
        "ids": [
          "f2"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f3"
        ],
        "scope": "H3"
      },
      {
        "rule": "negI",
        "ids": [
          "f4"
        ],
        "scope": "H2"
      },
      {
        "rule": "impI",
        "ids": [
          "f5"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 40
  },
  "L0-11": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "not",
            "a": {
              "k": "atom",
              "name": "A",
              "args": []
            }
          }
        },
        "scope": "H1"
      },
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "atom",
            "name": "A",
            "args": []
          }
        },
        "scope": "H2"
      },
      {
        "rule": "negE",
        "ids": [
          "H1",
          "H2"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f1"
        ],
        "scope": "H2"
      },
      {
        "rule": "impI",
        "ids": [
          "f2"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 9
  },
  "L0-12": null,
  "L0-13": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "atom",
          "name": "A",
          "args": []
        },
        "scope": "H1"
      },
      {
        "rule": "impE",
        "ids": [
          "p1",
          "H1"
        ]
      },
      {
        "rule": "impE",
        "ids": [
          "p2",
          "f1"
        ]
      },
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "atom",
            "name": "C",
            "args": []
          }
        },
        "scope": "H2"
      },
      {
        "rule": "negE",
        "ids": [
          "H2",
          "f2"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f3"
        ],
        "scope": "H2"
      },
      {
        "rule": "impI",
        "ids": [
          "f4"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 23
  },
  "L0-14": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "f2"
        ]
      },
      {
        "rule": "hyp",
        "ids": [
          "f1"
        ]
      },
      {
        "rule": "iffI",
        "ids": [
          "f3",
          "f4"
        ]
      }
    ],
    "derivations": [
      {
        "rule": "iffE",
        "ids": [
          "p1"
        ],
        "pick": "→"
      },
      {
        "rule": "iffE",
        "ids": [
          "p1"
        ],
        "pick": "←"
      }
    ],
    "ms": 0,
    "nodes": 3
  },
  "L1-01": {
    "steps": [
      {
        "rule": "eqSym",
        "ids": [
          "p1"
        ]
      }
    ],
    "derivations": [],
    "ms": 1,
    "nodes": 3
  },
  "L1-02": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p2"
        ]
      },
      {
        "rule": "eqTrans",
        "ids": [
          "p1",
          "f1"
        ]
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 4
  },
  "L1-03": {
    "steps": [
      {
        "rule": "eqRefl",
        "ids": [],
        "term": {
          "k": "c",
          "name": "add",
          "args": [
            {
              "k": "v",
              "name": "y",
              "free": false
            },
            {
              "k": "n",
              "n": 1
            }
          ]
        }
      },
      {
        "rule": "eqRewrite",
        "ids": [
          "p1",
          "f1"
        ],
        "pick": "左"
      }
    ],
    "derivations": [],
    "ms": 1,
    "nodes": 5
  },
  "L1-04": {
    "steps": [
      {
        "rule": "allE",
        "ids": [
          "ax:F2"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "f1"
        ],
        "term": {
          "k": "v",
          "name": "y",
          "free": false
        }
      }
    ],
    "derivations": [],
    "ms": 12,
    "nodes": 13
  },
  "L1-05": null,
  "L1-06": {
    "steps": [
      {
        "rule": "eqRefl",
        "ids": [],
        "term": {
          "k": "c",
          "name": "add",
          "args": [
            {
              "k": "v",
              "name": "y",
              "free": false
            },
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "eqRewrite",
        "ids": [
          "p1",
          "f1"
        ],
        "pick": "左"
      }
    ],
    "derivations": [],
    "ms": 1,
    "nodes": 5
  },
  "L1-07": {
    "steps": [
      {
        "rule": "eqRefl",
        "ids": [],
        "term": {
          "k": "c",
          "name": "mul",
          "args": [
            {
              "k": "n",
              "n": 5
            },
            {
              "k": "v",
              "name": "x",
              "free": false
            }
          ]
        }
      }
    ],
    "derivations": [],
    "ms": 12,
    "nodes": 79
  },
  "L1-08": {
    "steps": [
      {
        "rule": "eqRefl",
        "ids": [],
        "term": {
          "k": "c",
          "name": "add",
          "args": [
            {
              "k": "c",
              "name": "add",
              "args": [
                {
                  "k": "c",
                  "name": "sq",
                  "args": [
                    {
                      "k": "v",
                      "name": "x",
                      "free": false
                    }
                  ]
                },
                {
                  "k": "c",
                  "name": "mul",
                  "args": [
                    {
                      "k": "n",
                      "n": 2
                    },
                    {
                      "k": "v",
                      "name": "x",
                      "free": false
                    }
                  ]
                }
              ]
            },
            {
              "k": "n",
              "n": 1
            }
          ]
        }
      }
    ],
    "derivations": [],
    "ms": 18,
    "nodes": 79
  },
  "L1-09": {
    "steps": [
      {
        "rule": "eqRefl",
        "ids": [],
        "term": {
          "k": "c",
          "name": "sub",
          "args": [
            {
              "k": "c",
              "name": "sq",
              "args": [
                {
                  "k": "v",
                  "name": "x",
                  "free": false
                }
              ]
            },
            {
              "k": "c",
              "name": "sq",
              "args": [
                {
                  "k": "v",
                  "name": "y",
                  "free": false
                }
              ]
            }
          ]
        }
      }
    ],
    "derivations": [],
    "ms": 18,
    "nodes": 79
  },
  "L1-10": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p1"
        ]
      },
      {
        "rule": "eqOp",
        "ids": [
          "f1"
        ],
        "op": {
          "name": "sub",
          "n": 1
        }
      },
      {
        "rule": "eqOp",
        "ids": [
          "f2"
        ],
        "op": {
          "name": "div",
          "n": 2
        }
      }
    ],
    "derivations": [],
    "ms": 8,
    "nodes": 846
  },
  "L1-11": {
    "steps": [
      {
        "rule": "assume",
        "assume": {
          "k": "not",
          "a": {
            "k": "atom",
            "name": "ge",
            "args": [
              {
                "k": "c",
                "name": "sq",
                "args": [
                  {
                    "k": "v",
                    "name": "a",
                    "free": false
                  }
                ]
              },
              {
                "k": "n",
                "n": 0
              }
            ]
          }
        },
        "scope": "H1"
      },
      {
        "rule": "negE",
        "ids": [
          "H1",
          "f26"
        ]
      },
      {
        "rule": "raa",
        "ids": [
          "f37"
        ],
        "scope": "H1"
      }
    ],
    "derivations": [
      {
        "rule": "allE",
        "ids": [
          "ax:O1"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O1"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O1"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O1"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O2"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O2"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O2"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O2"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O3"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O3"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O3"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O3"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O4"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O4"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O4"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O4"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O5"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O5"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O5"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O5"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O6"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O6"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O6"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O6"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O7"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O7"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O7"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O7"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O8"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O8"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O8"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O8"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O9"
        ],
        "term": {
          "k": "c",
          "name": "sq",
          "args": [
            {
              "k": "v",
              "name": "a",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O9"
        ],
        "term": {
          "k": "v",
          "name": "a",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O9"
        ],
        "term": {
          "k": "n",
          "n": 0
        }
      },
      {
        "rule": "allE",
        "ids": [
          "ax:O9"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": true
        }
      }
    ],
    "ms": 9,
    "nodes": 171
  },
  "L1-12": null,
  "L1-13": null,
  "L1-14": null,
  "L0-15": {
    "steps": [
      {
        "rule": "hyp",
        "ids": [
          "p1"
        ]
      },
      {
        "rule": "hyp",
        "ids": [
          "p3"
        ]
      },
      {
        "rule": "orE",
        "ids": [
          "p4",
          "f1",
          "f2"
        ]
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 36
  },
  "L0-16": null,
  "L1-15": {
    "steps": [
      {
        "rule": "allE",
        "ids": [
          "ax:F2"
        ],
        "term": {
          "k": "v",
          "name": "y",
          "free": false
        }
      },
      {
        "rule": "allE",
        "ids": [
          "f1"
        ],
        "term": {
          "k": "v",
          "name": "x",
          "free": false
        }
      }
    ],
    "derivations": [],
    "ms": 0,
    "nodes": 3
  },
  "L1-16": {
    "steps": [
      {
        "rule": "eqRefl",
        "ids": [],
        "term": {
          "k": "c",
          "name": "add",
          "args": [
            {
              "k": "c",
              "name": "add",
              "args": [
                {
                  "k": "v",
                  "name": "x",
                  "free": false
                },
                {
                  "k": "v",
                  "name": "y",
                  "free": false
                }
              ]
            },
            {
              "k": "v",
              "name": "z",
              "free": false
            }
          ]
        }
      },
      {
        "rule": "eqRewrite",
        "ids": [
          "p1",
          "f1"
        ],
        "pick": "左"
      }
    ],
    "derivations": [],
    "ms": 2,
    "nodes": 5
  }
};
